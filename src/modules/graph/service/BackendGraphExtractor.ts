import type { BackendHttpClient } from '@/services/BackendClient';
import type { Result } from '@/errors/types';
import { ok, err } from '@/errors/ResultFactory';
import { AppError } from '@/errors/AppError';
import type { KnowledgeGraph } from '@/modules/graph/types/GraphTypes';

export interface GraphExtractor {
  extract(documentId: string): Promise<Result<KnowledgeGraph>>;
}

export function createBackendGraphExtractor(client: BackendHttpClient): GraphExtractor {
  return {
    async extract(documentId) {
      try {
        const graph = await client.post<KnowledgeGraph>('/api/graph/extract', { documentId });
        return ok(graph);
      } catch (e) {
        return err(AppError.from(e));
      }
    },
  };
}
