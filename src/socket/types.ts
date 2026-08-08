import type { Result } from '@/errors/types';
import type { UnsubscribeFn } from '@/events/types';

export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface SocketMessage<T = unknown> {
  topic: string;
  payload: T;
  timestamp: number;
  correlationId?: string;
}

export interface ISocketClient {
  readonly status: SocketStatus;
  connect(): Promise<Result<void>>;
  disconnect(): Promise<Result<void>>;
  onMessage(handler: (message: SocketMessage) => void): UnsubscribeFn;
  send(message: SocketMessage): Promise<Result<void>>;
}
