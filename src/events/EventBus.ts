import { v4 as uuid } from 'uuid';
import { AppError } from '@/errors/AppError';
import type { ILogger } from '@/logging/ILogger';
import type { DomainEvent, DomainEventSource, EventListener, IEventBus, EventStreamObserver, UnsubscribeFn } from './types';

interface Subscriber {
  id: string;
  topic: string;
  listener: EventListener;
  priority: number;
}

export class EventBus implements IEventBus {
  private subscribers = new Map<string, Map<string, Subscriber>>();
  private observers: EventStreamObserver[] = [];
  private readonly maxHistory = 200;
  private history: DomainEvent[] = [];

  constructor(private readonly logger: ILogger) {}

  addObserver(observer: EventStreamObserver): UnsubscribeFn {
    this.observers.push(observer);
    return () => {
      const idx = this.observers.indexOf(observer);
      if (idx > -1) this.observers.splice(idx, 1);
      return true;
    };
  }

  publish<T = unknown>(
    topic: string,
    payload: T,
    source: DomainEventSource = 'client',
    correlationId?: string,
  ): boolean {
    const event = this.createEvent(topic, payload, source, correlationId);
    this.record(event);
    this.notifyObservers(event);
    this.dispatch(event).catch((e: unknown) => {
      this.logger.error('Event dispatch failed', { topic, error: AppError.from(e) });
    });
    return true;
  }

  async publishAndWait<T = unknown>(
    topic: string,
    payload: T,
    source: DomainEventSource = 'client',
    correlationId?: string,
  ): Promise<void> {
    const event = this.createEvent(topic, payload, source, correlationId);
    this.record(event);
    this.notifyObservers(event);
    await this.dispatch(event);
  }

  subscribe<T = unknown>(topic: string, listener: EventListener<T>, priority = 0): UnsubscribeFn {
    const id = uuid();
    const map = this.subscribers.get(topic) ?? new Map();
    map.set(id, { id, topic, listener: listener as EventListener, priority });
    this.subscribers.set(topic, map);
    return () => map.delete(id);
  }

  once<T = unknown>(topic: string, listener: EventListener<T>, priority = 0): UnsubscribeFn {
    const unsubscribe = this.subscribe<T>(topic, async (event) => {
      unsubscribe();
      return listener(event);
    }, priority);
    return unsubscribe;
  }

  clear(topic?: string): void {
    if (topic) this.subscribers.delete(topic);
    else this.subscribers.clear();
  }

  snapshot(topic?: string): DomainEvent[] {
    if (!topic) return [...this.history];
    return this.history.filter((e) => e.topic === topic);
  }

  private createEvent<T>(
    topic: string,
    payload: T,
    source: DomainEventSource,
    correlationId?: string,
  ): DomainEvent<T> {
    return {
      id: uuid(),
      topic,
      payload,
      timestamp: Date.now(),
      correlationId: correlationId ?? uuid(),
      source,
    };
  }

  private record(event: DomainEvent): void {
    this.history.push(event);
    if (this.history.length > this.maxHistory) this.history.shift();
  }

  private notifyObservers(event: DomainEvent): void {
    for (let i = this.observers.length - 1; i >= 0; i--) {
      this.observers[i]?.onEvent(event);
    }
  }

  private async dispatch<T>(event: DomainEvent<T>): Promise<void> {
    const map = this.subscribers.get(event.topic);
    if (!map) return;
    const sorted = [...map.values()].sort((a, b) => b.priority - a.priority);
    for (const sub of sorted) {
      try {
        const maybeResult = await sub.listener(event);
        if (maybeResult && !maybeResult.success && maybeResult.error) {
          this.logger.warn('Event listener returned error', { topic: event.topic, error: maybeResult.error });
        }
      } catch (e) {
        this.logger.error('Event listener threw', { topic: event.topic, error: AppError.from(e) });
      }
    }
  }
}

export const createDefaultEventBus = (logger: ILogger) => new EventBus(logger);
