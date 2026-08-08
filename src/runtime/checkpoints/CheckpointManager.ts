import type { Result } from '@/errors/types';
import { ok } from '@/errors/ResultFactory';
import type { ICache } from '@/cache/types';
import type { Checkpoint, PipelineDAG, Task } from '../types';

const CHECKPOINT_PREFIX = 'aios-checkpoint-';

export class CheckpointManager {
  constructor(private readonly cache: ICache) {}

  async save(pipeline: PipelineDAG, nodeStates: Map<string, Task>): Promise<Result<Checkpoint>> {
    const completedNodes = pipeline.nodes
      .filter((n) => ['SUCCESS', 'PARTIAL_SUCCESS', 'FALLBACK'].includes(nodeStates.get(n.id)?.status ?? ''))
      .map((n) => n.id);

    const checkpoint: Checkpoint = {
      pipelineId: pipeline.id,
      correlationId: pipeline.correlationId,
      completedNodes,
      nodeStates: Object.fromEntries(
        [...nodeStates.entries()].map(([id, task]) => [
          id,
          { status: task.status, result: task.result, retryCount: task.retryCount, recoveryPath: task.recoveryPath },
        ]),
      ),
      createdAt: Date.now(),
    };

    const key = this.key(pipeline.id, pipeline.correlationId);
    await this.cache.set(key, checkpoint, 7 * 24 * 60 * 60 * 1000);
    return ok(checkpoint);
  }

  async load(pipelineId: string, correlationId: string): Promise<Result<Checkpoint>> {
    const key = this.key(pipelineId, correlationId);
    return this.cache.get<Checkpoint>(key);
  }

  async clear(pipelineId: string, correlationId: string): Promise<Result<void>> {
    return this.cache.delete(this.key(pipelineId, correlationId));
  }

  private key(pipelineId: string, correlationId: string): string {
    return `${CHECKPOINT_PREFIX}${pipelineId}:${correlationId}`;
  }
}
