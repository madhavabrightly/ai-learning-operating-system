import type { Result } from '@/errors/types';
import type { Checkpoint, PipelineDAG, Task } from '@/runtime/types';

export interface ICheckpointManager {
  save(pipeline: PipelineDAG, nodeStates: Map<string, Task>): Promise<Result<Checkpoint>>;
  load(pipelineId: string, correlationId: string): Promise<Result<Checkpoint>>;
  clear(pipelineId: string, correlationId: string): Promise<Result<void>>;
}
