import { AppError } from '@/errors/AppError';
import { err, fromPromise, ok } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';
import { BaseSocketClient } from './WebSocketClient';
import type { SocketMessage } from './types';

export interface HttpSocketOptions {
  baseUrl: string;
  pollIntervalMs?: number;
}

export class HttpSocketClient extends BaseSocketClient {
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private disposed = false;

  constructor(
    logger: ILogger,
    eventBus: IEventBus,
    private options: HttpSocketOptions,
  ) {
    super(logger, eventBus);
  }

  async connect(): Promise<Result<void>> {
    if (this._status === 'connected' || this._status === 'connecting') return ok(undefined);
    this.setStatus('connecting');
    this.abortController = new AbortController();
    const hello = await fromPromise(
      () =>
        fetch(`${this.options.baseUrl}/api/v1/health`, { signal: this.abortController?.signal }).then((r) =>
          r.ok ? r.json() : Promise.reject(new Error('Health failed')),
        ),
      { retryable: true },
    );
    if (this.disposed || this.abortController?.signal.aborted) {
      return err('HTTP client disconnected during connection', false);
    }
    if (!hello.success) return err(hello.error ?? 'Backend unreachable', true);
    this.setStatus('connected');
    this.startPolling();
    return ok(undefined);
  }

  async disconnect(): Promise<Result<void>> {
    this.disposed = true;
    this.abortController?.abort();
    this.abortController = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.setStatus('disconnected');
    return ok(undefined);
  }

  async send(message: SocketMessage): Promise<Result<void>> {
    if (this.disposed) return err('HTTP client is disconnected', false);
    return fromPromise(
      async () => {
        const controller = new AbortController();
        const res = await fetch(`${this.options.baseUrl}/api/v1/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
          signal: controller.signal,
        });
        if (!res.ok) throw new AppError({ message: 'HTTP event dispatch failed', retryable: true });
      },
      { retryable: true },
    );
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (!this.disposed) {
        void this.poll();
      }
    }, this.options.pollIntervalMs ?? 5000);
  }

  private async poll(): Promise<void> {
    const controller = new AbortController();
    const result = await fromPromise(
      async () => {
        const res = await fetch(`${this.options.baseUrl}/api/v1/events/poll`, { signal: controller.signal });
        if (!res.ok) throw new Error('Poll failed');
        return (await res.json()) as SocketMessage[];
      },
      { retryable: true },
    );
    if (this.disposed) return;
    if (!result.success) {
      this.setStatus('error');
      return;
    }
    for (const message of result.data ?? []) {
      this.receive(message);
      this.emitBusEvent(message);
    }
  }
}
