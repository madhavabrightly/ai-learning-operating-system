import { ok } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import type { IEventBus } from '@/events/types';
import { EventTopics } from '@/events/EventTopics';
import type { ILogger } from '@/logging/ILogger';
import { HttpSocketClient } from './HttpSocketClient';
import { NativeWebSocketClient } from './WebSocketClient';
import type { ISocketClient, SocketMessage, SocketStatus } from './types';

export interface SocketServiceOptions {
  mode: 'websocket' | 'http';
  url?: string;
  baseUrl?: string;
}

export class SocketService implements ISocketClient {
  private client: ISocketClient;
  private unsubscribeFromBus: (() => boolean) | null = null;

  constructor(
    private readonly logger: ILogger,
    private readonly eventBus: IEventBus,
    options: SocketServiceOptions,
  ) {
    this.client =
      options.mode === 'websocket'
        ? new NativeWebSocketClient(logger.child('ws'), eventBus, options.url ?? '/ws/v1/events')
        : new HttpSocketClient(logger.child('http'), eventBus, { baseUrl: options.baseUrl ?? '/api/v1', pollIntervalMs: 5000 });
    this.forwardBusEvents();
  }

  get status(): SocketStatus {
    return this.client.status;
  }

  async connect(): Promise<Result<void>> {
    return this.client.connect();
  }

  async disconnect(): Promise<Result<void>> {
    if (this.unsubscribeFromBus) {
      this.unsubscribeFromBus();
      this.unsubscribeFromBus = null;
    }
    return this.client.disconnect();
  }

  onMessage(handler: (message: SocketMessage) => void): () => boolean {
    return this.client.onMessage(handler);
  }

  async send(message: SocketMessage): Promise<Result<void>> {
    return this.client.send(message);
  }

  async changeClient(options: SocketServiceOptions): Promise<Result<void>> {
    const disconnectResult = await this.disconnect();
    if (!disconnectResult.success) {
      this.logger.warn('SocketService.changeClient disconnect returned error', { error: disconnectResult.error });
    }
    this.client =
      options.mode === 'websocket'
        ? new NativeWebSocketClient(this.logger.child('ws'), this.eventBus, options.url ?? '/ws/v1/events')
        : new HttpSocketClient(this.logger.child('http'), this.eventBus, { baseUrl: options.baseUrl ?? '/api/v1', pollIntervalMs: 5000 });
    this.forwardBusEvents();
    return ok(undefined);
  }

  private forwardBusEvents(): void {
    if (this.unsubscribeFromBus) this.unsubscribeFromBus();
    this.unsubscribeFromBus = this.eventBus.subscribe(EventTopics.SOCKET_PROGRESS, async (event) => {
      const message: SocketMessage = {
        topic: event.topic,
        payload: event.payload,
        timestamp: event.timestamp,
        correlationId: event.correlationId,
      };
      const sent = await this.client.send(message);
      if (!sent.success) {
        this.logger.warn('Failed to forward event to backend', { error: sent.error });
      }
    });
  }
}
