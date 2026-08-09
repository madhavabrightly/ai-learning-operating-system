import { AppError } from '@/errors/AppError';
import { ok, err } from '@/errors/ResultFactory';
import { IWorker, WorkerContext, WorkerType } from '@/runtime/types';

export interface MockWorkerOptions {
  delayMs?: number;
  failureRate?: number;
  recoveryRetries?: number;
}

export function createMockWorker(type: WorkerType, options: MockWorkerOptions = {}): IWorker {
  const { delayMs = 600, failureRate = 0, recoveryRetries = 1 } = options;
  return {
    type,
    async execute(ctx: WorkerContext) {
      if (ctx.cancellation.isCancelled) {
        return err(new AppError({ message: 'Cancelled', code: 'CANCELLED', retryable: false }));
      }

      ctx.emitProgress(10, `${type} queued`);
      await delay(120);
      ctx.emitProgress(35, `${type} running`);

      if (failureRate > 0 && Math.random() < failureRate && ctx.task.retryCount < recoveryRetries) {
        // first attempts intentionally fail to trigger retry/recovery path
        return transientError(type);
      }

      if (delayMs > 0) {
        await delayWithCancellation(delayMs, ctx, 5, (p) => ctx.emitProgress(35 + Math.floor(p * 0.55)));
      }

      ctx.emitProgress(100, `${type} completed`);
      return ok({ worker: type, output: `${type}-result`, retryCount: ctx.task.retryCount });
    },
  };
}

function transientError(type: WorkerType) {
  return err(
    new AppError({
      message: `${type} transient failure`,
      code: 'TIMEOUT',
      retryable: true,
      fallbackAvailable: true,
    }),
  );
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function delayWithCancellation(
  ms: number,
  ctx: WorkerContext,
  steps: number,
  onProgress: (pct: number) => void,
): Promise<void> {
  const stepMs = ms / steps;
  for (let i = 0; i < steps; i++) {
    ctx.cancellation.throwIfCancelled();
    await delay(stepMs);
    onProgress((i + 1) / steps);
  }
}
