import type { Result } from '@/errors/types';
import type {
  IWorker,
  PipelineDAG,
  Task,
  TaskDefinition,
  TelemetrySnapshot,
  Checkpoint,
} from '@/runtime/types';
import type { CircuitBreaker } from '@/runtime/circuit/CircuitBreaker';
import type { WorkerRegistry } from '@/runtime/workers/WorkerRegistry';
import type { UnsubscribeFn } from '@/events/types';

export interface IRuntimeOrchestrator {
  start(): void;
  stop(): void;
  registerWorker(worker: IWorker, breaker?: CircuitBreaker): void;
  createTask(definition: TaskDefinition, correlationId?: string, parentId?: string): Task;
  createPipeline(dag: Omit<PipelineDAG, 'correlationId'>): PipelineDAG;
  submitPipeline(pipeline: PipelineDAG): Promise<Result<Map<string, Task>>>;
  cancelTask(taskId: string): void;
  checkpoint(pipelineId: string): Promise<Result<Checkpoint>>;
  getTelemetry(): TelemetrySnapshot[];
  workerRegistryInstance: WorkerRegistry;
  taskRegistry: ReadonlyMap<string, Task>;
  onStatusChange(handler: () => void): UnsubscribeFn;
}
