import type { Result } from '@/errors/types';
import type { AppError } from '@/errors/AppError';

export type ErrorCategory =
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'NETWORK'
  | 'VALIDATION'
  | 'AUTH'
  | 'PLUGIN'
  | 'AI_PROVIDER'
  | 'OCR'
  | 'PARSER'
  | 'DATABASE'
  | 'UNKNOWN';

export interface ErrorClassification {
  category: ErrorCategory;
  retry: boolean;
  fallback: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  notifyUser: boolean;
  telemetry: boolean;
}

export type TaskStatus =
  | 'CREATED'
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING'
  | 'RETRYING'
  | 'FALLBACK'
  | 'PARTIAL_SUCCESS'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMEOUT';

export type WorkerType =
  | 'parser'
  | 'ocr'
  | 'knowledge'
  | 'graph'
  | 'summary'
  | 'quiz'
  | 'revision'
  | 'research'
  | 'export'
  | 'generic';

export interface Task {
  id: string;
  correlationId: string;
  parentTaskId?: string;
  priority: number;
  status: TaskStatus;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  updatedAt: number;
  timeoutMs: number;
  worker: WorkerType;
  metadata: Record<string, unknown>;
  input: unknown;
  progress: number;
  result?: unknown;
  error?: AppError;
  recoveryPath?: string[];
}

export interface TaskDefinition {
  id: string;
  worker: WorkerType;
  priority?: number;
  timeoutMs?: number;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
  input?: unknown;
  dependencies?: string[];
}

export interface PipelineNode {
  id: string;
  task: TaskDefinition;
  inputs: string[];
  outputs: string[];
  dependencies: string[];
  estimatedCost: number;
  estimatedTimeMs: number;
  requiredPlugins: string[];
}

export interface PipelineDAG {
  id: string;
  correlationId: string;
  nodes: PipelineNode[];
}

export interface CancellationToken {
  readonly isCancelled: boolean;
  throwIfCancelled(): void;
}

export interface WorkerContext {
  task: Task;
  cancellation: CancellationToken;
  traceId: string;
  emitProgress(percent: number, message?: string): void;
  emitWarning(error: AppError): void;
}

export interface IWorker {
  readonly type: WorkerType;
  execute(context: WorkerContext): Promise<Result<unknown>>;
}

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableCategories: ErrorCategory[];
  shouldRetry(error: AppError, attempt: number): boolean;
  calculateDelay(attempt: number): number;
}

export interface CircuitBreakerPolicy {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxCalls: number;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface SchedulerOptions {
  maxConcurrency: number;
  queueLimit: number;
  defaultTimeoutMs: number;
  defaultRetryPolicy: RetryPolicy;
}

export interface Checkpoint {
  pipelineId: string;
  correlationId: string;
  completedNodes: string[];
  nodeStates: Record<string, Partial<Task>>;
  createdAt: number;
}

export interface TelemetrySnapshot {
  timestamp: number;
  correlationId: string;
  taskId: string;
  worker?: string;
  plugin?: string;
  durationMs: number;
  queueWaitMs: number;
  retries: number;
  status: TaskStatus;
  errorCategory?: ErrorCategory;
  recoveryPath?: string[];
  memoryMB?: number;
}
