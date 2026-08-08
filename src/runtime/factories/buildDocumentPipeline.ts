import type { PipelineDAG } from '@/runtime/types';

/**
 * Build a real processing pipeline for an uploaded document.
 *
 * Stages:
 *   parse (real parser) → structure (normalizer) → concepts (real extraction)
 *
 * The parse stage itself produces the canonical structure, math, tables and
 * figures, so the DAG keeps explicit stages for observability while the heavy
 * work happens inside the parse worker (which emits granular progress).
 */
export function buildDocumentPipeline(documentId: string): Omit<PipelineDAG, 'correlationId'> {
  return {
    id: `pipeline-${documentId}`,
    nodes: [
      {
        id: 'parse',
        task: {
          id: 'parse',
          worker: 'parser',
          input: { documentId, stage: 'parse' },
          metadata: { pipelineStage: 'parse' },
        },
        inputs: ['raw'],
        outputs: ['parsed'],
        dependencies: [],
        estimatedCost: 10,
        estimatedTimeMs: 5000,
        requiredPlugins: [],
      },
      {
        id: 'concepts',
        task: {
          id: 'concepts',
          worker: 'knowledge',
          input: { documentId, stage: 'concepts' },
          metadata: { pipelineStage: 'concepts' },
        },
        inputs: ['parsed'],
        outputs: ['concepts'],
        dependencies: ['parse'],
        estimatedCost: 4,
        estimatedTimeMs: 3000,
        requiredPlugins: [],
      },
    ],
  };
}

/** Build a single-stage pipeline (used for retry of a failed stage). */
export function buildStagePipeline(documentId: string, stageId: string, worker: string): Omit<PipelineDAG, 'correlationId'> {
  return {
    id: `pipeline-${documentId}-${stageId}`,
    nodes: [
      {
        id: stageId,
        task: { id: stageId, worker: worker as never, input: { documentId, stage: stageId } },
        inputs: ['doc'],
        outputs: ['result'],
        dependencies: [],
        estimatedCost: 1,
        estimatedTimeMs: 3000,
        requiredPlugins: [],
      },
    ],
  };
}
