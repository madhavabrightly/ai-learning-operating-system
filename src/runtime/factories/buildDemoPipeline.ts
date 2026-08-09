import { PipelineDAG } from '@/runtime/types';

export function buildDemoPipeline(documentId: string): Omit<PipelineDAG, 'correlationId'> {
  return {
    id: `pipeline-${documentId}`,
    nodes: [
      {
        id: 'upload',
        task: { id: 'upload', worker: 'generic', input: { documentId, stage: 'upload' } },
        inputs: ['raw'],
        outputs: ['document'],
        dependencies: [],
        estimatedCost: 1,
        estimatedTimeMs: 100,
        requiredPlugins: [],
      },
      {
        id: 'layout',
        task: { id: 'layout', worker: 'ocr', input: { documentId, stage: 'layout' } },
        inputs: ['document'],
        outputs: ['layout_result'],
        dependencies: ['upload'],
        estimatedCost: 2,
        estimatedTimeMs: 600,
        requiredPlugins: [],
      },
      {
        id: 'parse',
        task: { id: 'parse', worker: 'parser', input: { documentId, stage: 'parse' } },
        inputs: ['layout_result'],
        outputs: ['structure'],
        dependencies: ['layout'],
        estimatedCost: 3,
        estimatedTimeMs: 700,
        requiredPlugins: [],
      },
      {
        id: 'knowledge',
        task: { id: 'knowledge', worker: 'knowledge', input: { documentId, stage: 'knowledge' } },
        inputs: ['structure'],
        outputs: ['entities'],
        dependencies: ['parse'],
        estimatedCost: 4,
        estimatedTimeMs: 800,
        requiredPlugins: [],
      },
      {
        id: 'summary',
        task: { id: 'summary', worker: 'summary', input: { documentId, stage: 'summary' } },
        inputs: ['entities'],
        outputs: ['summary_result'],
        dependencies: ['knowledge'],
        estimatedCost: 5,
        estimatedTimeMs: 900,
        requiredPlugins: [],
      },
      {
        id: 'graph',
        task: { id: 'graph', worker: 'graph', input: { documentId, stage: 'graph' } },
        inputs: ['summary_result'],
        outputs: ['graph_result'],
        dependencies: ['summary'],
        estimatedCost: 6,
        estimatedTimeMs: 1000,
        requiredPlugins: [],
      },
    ],
  };
}
