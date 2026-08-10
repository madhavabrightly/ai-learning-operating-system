import type { BackendHttpClient } from '@/services/BackendClient';
import type { Result } from '@/errors/types';
import { ok, err } from '@/errors/ResultFactory';
import { AppError } from '@/errors/AppError';

import type {
  KnowledgeGraph,
} from '@/modules/graph/types/GraphTypes';

export interface GraphExtractionOptions {
  force?: boolean;

  /**
   * Maximum number of concepts requested from backend.
   */
  maxConcepts?: number;

  /**
   * Minimum extraction confidence.
   */
  minConfidence?: number;
}

export interface GraphExtractor {
  extract(
    documentId: string,
    options?: GraphExtractionOptions,
  ): Promise<Result<KnowledgeGraph>>;
}

interface BackendGraphResponse {
  documentId?: string;

  concepts?: KnowledgeGraph['concepts'];

  relationships?: KnowledgeGraph['relationships'];

  metadata?: KnowledgeGraph['metadata'];
}

export function createBackendGraphExtractor(
  client: BackendHttpClient,
): GraphExtractor {
  return {
    async extract(
      documentId: string,
      options: GraphExtractionOptions = {},
    ): Promise<Result<KnowledgeGraph>> {
      const id = documentId.trim();

      if (!id) {
        return err(
          AppError.from(
            new Error(
              'documentId is required for graph extraction',
            ),
          ),
        );
      }

      try {
        const response =
          await client.post<BackendGraphResponse>(
            '/api/graph/extract',
            {
              documentId: id,

              force:
                options.force ?? false,

              maxConcepts:
                options.maxConcepts ?? 250,

              minConfidence:
                options.minConfidence ?? 0.55,
            },
          );

        if (!response) {
          return err(
            AppError.from(
              new Error(
                'Graph backend returned no response',
              ),
            ),
          );
        }

        const concepts =
          Array.isArray(response.concepts)
            ? response.concepts
            : [];

        const relationships =
          Array.isArray(
            response.relationships,
          )
            ? response.relationships
            : [];

        const graph: KnowledgeGraph = {
          documentId:
            response.documentId ?? id,

          concepts,

          relationships,

          metadata: {
            ...(response.metadata ?? {}),

            generatedAt:
              response.metadata?.generatedAt ??
              new Date().toISOString(),

            conceptCount:
              concepts.length,

            relationshipCount:
              relationships.length,
          },
        };

        return ok(graph);
      } catch (error) {
        return err(
          AppError.from(error),
        );
      }
    },
  };
}