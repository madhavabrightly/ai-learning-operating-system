import type { PipelineDAG } from '@/runtime/types';

/**
 * Build a real document pipeline DAG using the real workers:
 *   upload (generic) → parse (parser) → knowledge (knowledge) → graph (graph)
 */
export function buildDocumentPipeline(documentId: string): Omit<PipelineDAG, 'correlationId'> {
  return {
    id: `pipeline-${documentId}`,
    nodes: [
      {
        id: `${documentId}:upload`,
        task: { id: `${documentId}:upload`, worker: 'generic', input: { documentId, stage: 'upload' } },
        inputs: ['file'],
        outputs: ['document'],
        dependencies: [],
        estimatedCost: 1,
        estimatedTimeMs: 200,
        requiredPlugins: [],
      },
      {
        id: `${documentId}:parse`,
        task: { id: `${documentId}:parse`, worker: 'parser', input: documentId, priority: 1 },
        inputs: ['document'],
        outputs: ['structure'],
        dependencies: [`${documentId}:upload`],
        estimatedCost: 3,
        estimatedTimeMs: 800,
        requiredPlugins: [],
      },
      {
        id: `${documentId}:knowledge`,
        task: { id: `${documentId}:knowledge`, worker: 'knowledge', input: documentId, priority: 2 },
        inputs: ['structure'],
        outputs: ['concepts'],
        dependencies: [`${documentId}:parse`],
        estimatedCost: 4,
        estimatedTimeMs: 1000,
        requiredPlugins: [],
      },
    ],
  };
}