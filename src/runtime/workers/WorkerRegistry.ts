import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';
import { CircuitBreaker } from '../circuit/CircuitBreaker';
import { MutableCancellationToken } from '../cancellation/CancellationToken';
import type { IWorker, PipelineNode, Task, WorkerContext, WorkerType, CircuitBreakerPolicy, RetryPolicy } from '../types';

export interface WorkerRegistryOptions {
  circuitBreakerPolicy: CircuitBreakerPolicy;
  defaultCircuitBreakerName?: string;
  retryPolicy: RetryPolicy;
  fallbackWorker: IWorker;
}

export class WorkerRegistry {
  private workers = new Map<WorkerType, IWorker>();
  private circuitBreakers = new Map<WorkerType, CircuitBreaker>();

  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly options: WorkerRegistryOptions,
  ) {}

  register(worker: IWorker, circuitBreaker?: CircuitBreaker): void {
    this.workers.set(worker.type, worker);
    if (circuitBreaker) {
      this.circuitBreakers.set(worker.type, circuitBreaker);
    }
  }

  resolve(node: PipelineNode): IWorker {
    const worker = this.workers.get(node.task.worker);
    if (!worker) {
      this.logger.warn(`No worker registered for ${node.task.worker}; using generic fallback`);
      return this.options.fallbackWorker;
    }
    return worker;
  }

  getCircuitBreaker(type: WorkerType): CircuitBreaker {
    let cb = this.circuitBreakers.get(type);
    if (!cb) {
      cb = new CircuitBreaker(type, this.options.circuitBreakerPolicy);
      this.circuitBreakers.set(type, cb);
    }
    return cb;
  }

  createContext(task: Task): WorkerContext {
    const cancellation = new MutableCancellationToken();
    return {
      task,
      cancellation,
      traceId: task.correlationId,
      emitProgress: (percent: number, message?: string) => {
        task.progress = Math.max(0, Math.min(100, percent));
        this.eventBus.publish('task.progress', { taskId: task.id, progress: task.progress, message }, 'client', task.correlationId);
      },
      emitWarning: (error) => {
        this.eventBus.publish('task.warning', { taskId: task.id, error: error.message }, 'client', task.correlationId);
      },
    };
  }
}
