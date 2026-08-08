import type { IWorker, PipelineNode, Task, WorkerContext, WorkerType } from '@/runtime/types';
import type { CircuitBreaker } from '@/runtime/circuit/CircuitBreaker';

export interface IWorkerRegistry {
  register(worker: IWorker, circuitBreaker?: CircuitBreaker): void;
  resolve(node: PipelineNode): IWorker;
  getCircuitBreaker(type: WorkerType): CircuitBreaker;
  createContext(task: Task): WorkerContext;
}
