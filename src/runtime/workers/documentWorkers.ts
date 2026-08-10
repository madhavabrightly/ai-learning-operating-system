import type { IWorker, WorkerContext } from '@/runtime/types';
import type { DocumentService } from '@/modules/document/service/DocumentService';
import type { FailureInjector } from '@/runtime/injection/FailureInjector';
import { ok, err } from '@/errors/ResultFactory';
import { AppError } from '@/errors/AppError';

/**
 * Create a parse worker that extracts document pages and progress.
 */
export function createParseWorker(
  documentService: DocumentService,
  failureInjector: FailureInjector,
): IWorker {
  return {
    type: 'parser',
    async execute(ctx: WorkerContext) {
      // Check cancellation
      if (ctx.cancellation.isCancelled) {
        return err(new AppError({ message: 'Cancelled', code: 'CANCELLED', retryable: false }));
      }

      // Optionally inject a failure for testing
      const injected = failureInjector.maybeInject('parser');
      if (injected) return err(injected);

      const documentId = ctx.task.input as string | undefined;
      if (!documentId) {
        return err(new AppError({ message: 'No documentId provided', code: 'VALIDATION_ERROR', retryable: false }));
      }

      ctx.emitProgress(10, 'Opening document…');
      const docResult = await documentService.getPages(documentId);
      if (!docResult.success) {
        return err(new AppError({ message: 'Failed to load pages', code: 'PARSER', retryable: true }));
      }

      ctx.emitProgress(50, 'Parsing layout…');
      await sleep(300);

      const pages = docResult.data ?? [];
      ctx.emitProgress(100, `Parsed ${pages.length} pages`);
      return ok({ documentId, pages: pages.length, stage: 'parse' });
    },
  };
}

/**
 * Create a concept/knowledge worker that extracts concepts via the graph service.
 */
export function createConceptWorker(
  deps: { extractConcepts: (documentId: string) => Promise<{ success: boolean; data?: unknown; error?: string }> },
  failureInjector: FailureInjector,
): IWorker {
  return {
    type: 'knowledge',
    async execute(ctx: WorkerContext) {
      if (ctx.cancellation.isCancelled) {
        return err(new AppError({ message: 'Cancelled', code: 'CANCELLED', retryable: false }));
      }

      const injected = failureInjector.maybeInject('knowledge');
      if (injected) return err(injected);

      const documentId = ctx.task.input as string | undefined;
      if (!documentId) {
        return err(new AppError({ message: 'No documentId provided', code: 'VALIDATION_ERROR', retryable: false }));
      }

      ctx.emitProgress(20, 'Extracting concepts…');
      await sleep(400);

      const result = await deps.extractConcepts(documentId);
      ctx.emitProgress(80, 'Building knowledge graph…');
      await sleep(200);

      if (!result.success) {
        return err(new AppError({ message: result.error ?? 'Concept extraction failed', code: 'KNOWLEDGE', retryable: true }));
      }

      ctx.emitProgress(100, 'Knowledge graph ready');
      return ok({ documentId, graph: result.data, stage: 'knowledge' });
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}