import type { Result } from '@/errors/types';

export type DomainEventSource = 'client' | 'server' | 'plugin';

export interface DomainEvent<T = unknown> {
  id: string;
  topic: string;
  payload: T;
  timestamp: number;
  correlationId?: string;
  source: DomainEventSource;
}

export type EventListener<T = unknown> = (event: DomainEvent<T>) => Promise<Result<void> | void> | Result<void> | void;

export type UnsubscribeFn = () => boolean;

export interface IEventBus {
  publish<T = unknown>(
    topic: string,
    payload: T,
    source?: DomainEventSource,
    correlationId?: string,
  ): boolean;
  publishAndWait<T = unknown>(
    topic: string,
    payload: T,
    source?: DomainEventSource,
    correlationId?: string,
  ): Promise<void>;
  subscribe<T = unknown>(topic: string, listener: EventListener<T>, priority?: number): UnsubscribeFn;
  once<T = unknown>(topic: string, listener: EventListener<T>, priority?: number): UnsubscribeFn;
  addObserver(observer: EventStreamObserver): UnsubscribeFn;
  clear(topic?: string): void;
  snapshot(topic?: string): DomainEvent[];
}

export interface EventStreamObserver {
  onEvent(event: DomainEvent): void;
}
