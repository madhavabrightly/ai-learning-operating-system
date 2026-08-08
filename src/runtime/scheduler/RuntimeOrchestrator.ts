import { v4 as uuid } from 'uuid';
import type { Result } from '@/errors/types';
import { err, ok } from '@/errors/ResultFactory';
import { AppError } from '@/errors/AppError';
import type { IContainer } from '@/di/types';
import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';
import type { ICache } from '@/cache/types';
import type { PerformanceTimer } from '@/logging/PerformanceTimer';
import { EventTopics } from '@/events/EventTopics';
import { classifyError } from '../errors/ErrorClassifier';
import { DEFAULT_RETRY_POLICY } from '../retry/RetryPolicy';
import { createCircuitBreakerPolicy } from '../circuit/CircuitBreaker';
import type { CircuitBreaker } from '../circuit/CircuitBreaker';
import { WorkerRegistry } from '../workers/WorkerRegistry';
import { CheckpointManager } from '../checkpoints/CheckpointManager';
import { MutableCancellationToken } from '../cancellation/CancellationToken';
import type { IRuntimeOrchestrator } from '../contracts/IRuntimeOrchestrator';
import type {
  IWorker,
  PipelineDAG,
  PipelineNode,
  SchedulerOptions,
  Task,
  TaskDefinition,
  TaskStatus,
  WorkerContext,
  TelemetrySnapshot,
  Checkpoint,
} from '../types';

interface RunningOp {
  task: Task;
  cancellation: MutableCancellationToken;
  promise: Promise<Result<unknown>>;
  node: PipelineNode;
  startedAt: number;
}

export class RuntimeOrchestrator implements IRuntimeOrchestrator {
  private statusListeners = new Set<() => void>();
  private tasks = new Map<string, Task>();
  private running = new Map<string, RunningOp>();
  private queue: string[] = [];
  private pipelines = new Map<string, PipelineDAG>();
  private completedPipelines = new Set<string>();
  private workerRegistry: WorkerRegistry;
  private checkpointManager: CheckpointManager;
  private options: SchedulerOptions;
  private telemetry: TelemetrySnapshot[] = [];
  private tickHandle?: ReturnType<typeof setInterval>;

  constructor(
    _container: IContainer,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    _cache: ICache,
    private readonly timer: PerformanceTimer,
    _options?: Partial<SchedulerOptions>,
  ) {
    this.options = {
      maxConcurrency: _options?.maxConcurrency ?? 4,
      queueLimit: _options?.queueLimit ?? 100,
      defaultTimeoutMs: _options?.defaultTimeoutMs ?? 30_000,
      defaultRetryPolicy: _options?.defaultRetryPolicy ?? DEFAULT_RETRY_POLICY,
    };

    const cbPolicy = createCircuitBreakerPolicy();
    const genericFallback: IWorker = {
      type: 'generic',
      execute: async () => ok({ fallback: true, reason: 'No registered worker' }),
    };

    this.workerRegistry = new WorkerRegistry(eventBus, logger, {
      circuitBreakerPolicy: cbPolicy,
      retryPolicy: this.options.defaultRetryPolicy,
      fallbackWorker: genericFallback,
    });
    this.checkpointManager = new CheckpointManager(_cache);
  }

  get workerRegistryInstance(): WorkerRegistry {
    return this.workerRegistry;
  }

  get taskRegistry(): ReadonlyMap<string, Task> {
    return this.tasks;
  }

  start(): void {
    if (this.tickHandle) return;
    this.tickHandle = setInterval(() => this.scheduleTick(), 50);
  }

  stop(): void {
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = undefined;
    }
    for (const op of this.running.values()) {
      op.cancellation.cancel();
    }
    this.running.clear();
  }

  registerWorker(worker: IWorker, breaker?: CircuitBreaker): void {
    this.workerRegistry.register(worker, breaker);
  }

  createTask(definition: TaskDefinition, correlationId?: string, parentId?: string): Task {
    const now = Date.now();
    const task: Task = {
      id: definition.id,
      correlationId: correlationId ?? uuid(),
      parentTaskId: parentId,
      priority: definition.priority ?? 0,
      status: 'CREATED',
      retryCount: 0,
      maxRetries: definition.maxRetries ?? this.options.defaultRetryPolicy.maxRetries,
      createdAt: now,
      updatedAt: now,
      timeoutMs: definition.timeoutMs ?? this.options.defaultTimeoutMs,
      worker: definition.worker,
      metadata: definition.metadata ?? {},
      input: definition.input,
      progress: 0,
      recoveryPath: [],
    };
    this.tasks.set(task.id, task);
    this.transition(task, 'QUEUED');
    this.queue.push(task.id);
    this.logger.info('Task created', { taskId: task.id, worker: task.worker, correlationId: task.correlationId });
    this.eventBus.publish(EventTopics.PROCESS_STARTED, { taskId: task.id, worker: task.worker }, 'client', task.correlationId);
    return task;
  }

  createPipeline(dag: Omit<PipelineDAG, 'correlationId'>): PipelineDAG {
    const pipeline: PipelineDAG = { ...dag, correlationId: uuid() };
    this.pipelines.set(pipeline.id, pipeline);
    return pipeline;
  }

  async submitPipeline(pipeline: PipelineDAG): Promise<Result<Map<string, Task>>> {
    if (this.queue.length + pipeline.nodes.length > this.options.queueLimit) {
      return err(new AppError({ message: 'Queue limit exceeded', code: 'QUEUE_FULL', retryable: false, fallbackAvailable: false }));
    }

    const checkpoint = await this.checkpointManager.load(pipeline.id, pipeline.correlationId);
    if (checkpoint.success && checkpoint.data) {
      this.logger.info('Resuming pipeline from checkpoint', { pipelineId: pipeline.id, completedNodes: checkpoint.data.completedNodes });
      this.applyCheckpoint(checkpoint.data, pipeline);
    }

    for (const node of pipeline.nodes) {
      if (!this.tasks.has(node.id)) {
        this.createTask(
          { ...node.task, id: node.id },
          pipeline.correlationId,
        );
      }
    }

    return ok(this.tasks);
  }

  private applyCheckpoint(checkpoint: import('../types').Checkpoint, pipeline: PipelineDAG): void {
    for (const node of pipeline.nodes) {
      const restored = checkpoint.nodeStates[node.id];
      if (!restored) continue;
      const task = this.tasks.get(node.id);
      if (!task) continue;
      if (restored.status) task.status = restored.status as TaskStatus;
      if (restored.result !== undefined) task.result = restored.result;
      if (restored.retryCount !== undefined) task.retryCount = restored.retryCount;
      if (restored.recoveryPath) task.recoveryPath = restored.recoveryPath;
      task.updatedAt = Date.now();
    }
  }

  cancelTask(taskId: string): void {
    const op = this.running.get(taskId);
    op?.cancellation.cancel();
  }

  private scheduleTick(): void {
    if (this.running.size >= this.options.maxConcurrency) return;
    if (this.queue.length === 0) {
      this.checkPipelineCompletion();
      return;
    }

    this.queue.sort((a, b) => (this.tasks.get(b)?.priority ?? 0) - (this.tasks.get(a)?.priority ?? 0));
    const nextId = this.queue.shift();
    if (!nextId) return;
    const task = this.tasks.get(nextId);
    if (!task) return;

    this.executeTask(task);
  }

  private executeTask(task: Task): void {
    const pipeline = this.findPipelineForTask(task);
    const node = pipeline?.nodes.find((n) => n.id === task.id);

    if (pipeline && node && !this.dependenciesSatisfied(node, pipeline)) {
      this.transition(task, 'WAITING');
      this.queue.push(task.id);
      return;
    }

    if (this.running.has(task.id)) return;
    this.transition(task, 'RUNNING');

    const cancellation = new MutableCancellationToken();
    const context = this.workerRegistry.createContext(task);

    const fallbackWorker: IWorker = { type: 'generic', execute: async () => ok({}) };
    const worker = node ? this.workerRegistry.resolve(node) : fallbackWorker;
    const timerId = this.timer.start(`task:${task.worker}:${task.id}`);
    const queuedAt = task.createdAt;

    const timeoutHandle = setTimeout(() => {
      cancellation.cancel();
      this.transition(task, 'TIMEOUT');
    }, task.timeoutMs);

    const resultPromise = this.runWithRetry(worker, context, task)
      .finally(() => {
        clearTimeout(timeoutHandle);
        this.timer.end(timerId);
        this.running.delete(task.id);
        this.recordTelemetry(task, queuedAt);
      });

    this.running.set(task.id, { task, cancellation, promise: resultPromise, node: node ?? ({ id: task.id, task: task as unknown as PipelineNode['task'], inputs: [], outputs: [], dependencies: [], estimatedCost: 0, estimatedTimeMs: 0, requiredPlugins: [] }), startedAt: Date.now() });
  }

  private async runWithRetry(worker: IWorker, context: WorkerContext, task: Task): Promise<Result<unknown>> {
    const policy = this.options.defaultRetryPolicy;
    let lastResult: Result<unknown> = ok(undefined);

    while (task.retryCount <= task.maxRetries) {
      lastResult = await worker.execute(context);
      if (lastResult.success) {
        task.result = lastResult.data;
        task.progress = 100;
        this.transition(task, 'SUCCESS');
        return lastResult;
      }

      const error = typeof lastResult.error === 'string' ? new AppError({ message: lastResult.error }) : (lastResult.error as AppError | undefined);
      if (!error) {
        this.transition(task, 'FAILED');
        return lastResult;
      }

      task.error = error;
      const classification = classifyError(error);
      if (policy.shouldRetry(error, task.retryCount)) {
        task.retryCount++;
        this.transition(task, 'RETRYING');
        task.recoveryPath?.push(`retry-${task.retryCount}`);
        const delay = policy.calculateDelay(task.retryCount);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      if (classification.fallback) {
        this.transition(task, 'FALLBACK');
        const fallback = await this.runFallback(task, context);
        if (fallback.success) {
          task.result = fallback.data;
          this.transition(task, 'PARTIAL_SUCCESS');
          return fallback;
        }
      }

      this.transition(task, 'FAILED');
      return lastResult;
    }

    this.transition(task, 'FAILED');
    return lastResult;
  }

  private async runFallback(task: Task, context: WorkerContext): Promise<Result<unknown>> {
    this.logger.warn('Executing fallback worker', { taskId: task.id, worker: task.worker });
    task.recoveryPath?.push('fallback');
    return this.workerRegistry['options'].fallbackWorker.execute(context);
  }

  private dependenciesSatisfied(node: PipelineNode, _pipeline: PipelineDAG): boolean {
    for (const depId of node.dependencies) {
      const depTask = this.tasks.get(depId);
      if (!depTask) return false;
      if (!['SUCCESS', 'PARTIAL_SUCCESS', 'FALLBACK'].includes(depTask.status)) return false;
    }
    return true;
  }

  private findPipelineForTask(task: Task): PipelineDAG | undefined {
    for (const pipeline of this.pipelines.values()) {
      if (pipeline.correlationId === task.correlationId) return pipeline;
    }
    return undefined;
  }

  private checkPipelineCompletion(): void {
    for (const pipeline of this.pipelines.values()) {
      if (this.completedPipelines.has(pipeline.id)) continue;
      const states = pipeline.nodes.map((n) => this.tasks.get(n.id)?.status ?? 'CREATED');
      const done = states.every((s) => ['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED', 'FALLBACK'].includes(s));
      if (done) {
        this.completedPipelines.add(pipeline.id);
        this.eventBus.publish(EventTopics.PROCESS_COMPLETED, { pipelineId: pipeline.id, states }, 'client', pipeline.correlationId);
        void this.checkpointManager.clear(pipeline.id, pipeline.correlationId);
      }
    }
  }

  onStatusChange(handler: () => void): () => boolean {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
  }

  private transition(task: Task, next: TaskStatus): void {
    const previous = task.status;
    task.status = next;
    task.updatedAt = Date.now();
    this.eventBus.publish(`task.${next.toLowerCase()}`, { taskId: task.id, previous, worker: task.worker }, 'client', task.correlationId);
    this.notifyStatusChange();
  }

  private notifyStatusChange(): void {
    for (const listener of this.statusListeners) {
      try { listener(); } catch { /* ignore */ }
    }
  }

  private recordTelemetry(task: Task, queuedAt: number): void {
    const snapshot: TelemetrySnapshot = {
      timestamp: Date.now(),
      correlationId: task.correlationId,
      taskId: task.id,
      worker: task.worker,
      durationMs: task.updatedAt - task.createdAt,
      queueWaitMs: queuedAt - task.createdAt,
      retries: task.retryCount,
      status: task.status,
      errorCategory: task.error ? classifyError(task.error).category : undefined,
      recoveryPath: task.recoveryPath,
    };
    this.telemetry.push(snapshot);
    if (task.status === 'FAILED' || task.status === 'PARTIAL_SUCCESS' || task.status === 'FALLBACK') {
      this.logger.info('Task completed with status', { ...snapshot });
    }
  }

  getTelemetry(): TelemetrySnapshot[] {
    return [...this.telemetry];
  }

  async checkpoint(pipelineId: string): Promise<Result<Checkpoint>> {
    const pipeline = this.pipelines.get(pipelineId);
    if (!pipeline) return err(`Pipeline ${pipelineId} not found`);
    return this.checkpointManager.save(pipeline, this.tasks);
  }
}
