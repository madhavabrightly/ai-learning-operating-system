import { AppError } from '@/errors/AppError';
import { err, fromPromise, ok } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';
import type { ISocketClient, SocketMessage, SocketStatus } from './types';

const WS_IDLE = 0;
const WS_OPEN = 1;

export abstract class BaseSocketClient implements ISocketClient {
  protected handlers = new Set<(message: SocketMessage) => void>();
  protected _status: SocketStatus = 'idle';
  private statusListeners = new Set<(status: SocketStatus) => void>();

  constructor(
    protected readonly logger: ILogger,
    protected readonly eventBus: IEventBus,
  ) {}

  get status(): SocketStatus {
    return this._status;
  }

  abstract connect(): Promise<Result<void>>;
  abstract disconnect(): Promise<Result<void>>;

  onStatusChange(handler: (status: SocketStatus) => void): () => boolean {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
  }

  protected setStatus(status: SocketStatus): void {
    this._status = status;
    this.statusListeners.forEach((h) => h(status));
  }

  onMessage(handler: (message: SocketMessage) => void): () => boolean {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  protected receive(message: SocketMessage): void {
    this.handlers.forEach((h) => h(message));
  }

  protected emitBusEvent(message: SocketMessage): void {
    this.eventBus.publish(message.topic, message.payload, 'server', message.correlationId);
  }

  abstract send(message: SocketMessage): Promise<Result<void>>;
}

export class NativeWebSocketClient extends BaseSocketClient {
  private ws: WebSocket | null = null;
  private connecting = false;

  constructor(
    logger: ILogger,
    eventBus: IEventBus,
    private readonly url: string,
  ) {
    super(logger, eventBus);
  }

  async connect(): Promise<Result<void>> {
    if (this.ws?.readyState === WS_OPEN) return ok(undefined);
    if (this.connecting) return err('WebSocket connection already in progress', false);
    this.connecting = true;
    this.setStatus('connecting');
    return fromPromise(
      () =>
        new Promise<void>((resolve, reject) => {
          try {
            const ws = new WebSocket(this.url);
            ws.onopen = () => {
              this.ws = ws;
              this.connecting = false;
              this.setStatus('connected');
              resolve();
            };
            ws.onclose = () => {
              const wasConnecting = this.connecting;
              this.ws = null;
              this.connecting = false;
              this.setStatus('disconnected');
              if (wasConnecting) {
                reject(new AppError({ message: 'WebSocket closed before open', retryable: true }));
              }
            };
            ws.onerror = (e) => {
              this.ws = null;
              this.connecting = false;
              this.setStatus('error');
              reject(new AppError({ message: 'WebSocket error', cause: e, retryable: true }));
            };
            ws.onmessage = (event) => {
              try {
                const message = JSON.parse(event.data as string) as SocketMessage;
                this.receive(message);
                this.emitBusEvent(message);
              } catch (e) {
                this.logger.error('Failed to parse socket message', { error: AppError.from(e) });
              }
            };
          } catch (e) {
            this.ws = null;
            this.connecting = false;
            this.setStatus('error');
            reject(e);
          }
        }),
      { retryable: true },
    );
  }

  async disconnect(): Promise<Result<void>> {
    if (!this.ws) {
      this.connecting = false;
      return ok(undefined);
    }
    if (this.ws.readyState === WS_IDLE || this.ws.readyState === WS_OPEN) {
      try {
        this.ws.close();
      } catch (e) {
        this.logger.warn('WebSocket close threw', { error: AppError.from(e) });
      }
    }
    this.ws = null;
    this.connecting = false;
    this.setStatus('disconnected');
    return ok(undefined);
  }

  async send(message: SocketMessage): Promise<Result<void>> {
    if (!this.ws || this.ws.readyState !== WS_OPEN) {
      return err('WebSocket not connected', true);
    }
    try {
      this.ws.send(JSON.stringify(message));
      return ok(undefined);
    } catch (e) {
      return err(AppError.from(e), true);
    }
  }
}
