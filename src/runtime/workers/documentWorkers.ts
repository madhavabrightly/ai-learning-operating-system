import type { IWorker, WorkerContext } from '@/runtime/types';
import { ok, err } from '@/errors/ResultFactory';
import { AppError } from '@/errors/AppError';
import type { DocumentService } from '@/modules/document/service/DocumentService';
import type { FailureInjector } from '@/runtime/injection/FailureInjector';

/**
 * Real pipeline workers backed by actual services.
 *
 * These replace the old mock workers. Each worker performs genuine work:
 * - 'parse' runs the real document parser + normalizer through DocumentService.
 * - 'concepts' runs concept extraction (AI or heuristic) through GraphService.
 */

export interface ParseWorkerInput {
  documentId: string;
}

export interface ConceptWorkerInput {
  documentId: string;
}

export function createParseWorker(documentService: DocumentService, failureInjector?: FailureInjector): IWorker {
  return {
    type: 'parser',
    async execute(ctx: WorkerContext) {
      const input = ctx.task.input as ParseWorkerInput | undefined;
      const documentId = input?.documentId;
      if (!documentId) {
        return err(new AppError({ message: 'Missing documentId for parse worker', code: 'VALIDATION_ERROR', retryable: false }));
      }

      // Developer failure injection: the real parser is skipped and a real
      // transient error is returned, exercising the retry path for real.
      if (failureInjector) {
        const injected = failureInjector.maybeFail('parse');
        if (injected) {
          ctx.emitWarning(injected);
          return err(injected);
        }
      }

      try {
        ctx.emitProgress(5, 'Loading document');
        const existing = await documentService.getDocument(documentId);
        // If the document is already fully parsed (upload triggered parsing),
        // don't re-parse — just confirm the pipeline stage succeeded.
        if (existing.success && existing.data && existing.data.metadata.pageCount > 0 && existing.data.status === 'READY') {
          ctx.emitProgress(100, 'Already parsed');
          return ok({
            documentId,
            status: existing.data.status,
            pages: existing.data.metadata.pageCount,
            stages: existing.data.processing.stages,
            reused: true,
          });
        }
        const result = await documentService.processDocument(documentId, (p) => {
          ctx.emitProgress(Math.round(p.fraction * 90) + 5, p.message ?? `Stage: ${p.stage}`);
        });

        if (!result.success || !result.data) {
          return err(
            new AppError({
              message: result.error ?? 'Document processing failed',
              code: 'PARSER_ERROR',
              retryable: true,
              fallbackAvailable: false,
            }),
          );
        }

        ctx.emitProgress(100, 'Parse complete');
        return ok({
          documentId,
          status: result.data.status,
          pages: result.data.metadata.pageCount,
          stages: result.data.processing.stages,
        });
      } catch (e) {
        return err(
          new AppError({
            message: AppError.from(e).message,
            code: 'PARSER_ERROR',
            retryable: true,
            fallbackAvailable: false,
          }),
        );
      }
    },
  };
}

export interface ConceptWorkerDeps {
  extractConcepts: (documentId: string) => Promise<{ success: boolean; data?: unknown; error?: string }>;
}

export function createConceptWorker(deps: ConceptWorkerDeps, failureInjector?: FailureInjector): IWorker {
  return {
    type: 'knowledge',
    async execute(ctx: WorkerContext) {
      const input = ctx.task.input as ConceptWorkerInput | undefined;
      const documentId = input?.documentId;
      if (!documentId) {
        return err(new AppError({ message: 'Missing documentId for concept worker', code: 'VALIDATION_ERROR', retryable: false }));
      }

      // Developer failure injection: a real transient error exercises retry.
      if (failureInjector) {
        const injected = failureInjector.maybeFail('concepts');
        if (injected) {
          ctx.emitWarning(injected);
          return err(injected);
        }
      }

      try {
        ctx.emitProgress(10, 'Extracting concepts');
        const result = await deps.extractConcepts(documentId);
        if (!result.success) {
          return err(
            new AppError({
              message: result.error ?? 'Concept extraction failed',
              code: 'AI_PROVIDER_ERROR',
              retryable: true,
              fallbackAvailable: true,
            }),
          );
        }
        ctx.emitProgress(100, 'Concepts extracted');
        return ok({ documentId, concepts: result.data });
      } catch (e) {
        return err(
          new AppError({
            message: AppError.from(e).message,
            code: 'AI_PROVIDER_ERROR',
            retryable: true,
            fallbackAvailable: true,
          }),
        );
      }
    },
  };
}
