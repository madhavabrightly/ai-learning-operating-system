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

  /**
   * Topics currently being dispatched. Guards against re-entrant publishes:
   * a listener that publishes the same topic it is reacting to must not
   * recurse synchronously (publish → dispatch → listener → publish → …),
   * which previously blew the call stack (CONCEPTS_EXTRACTED feedback loop).
   */
  private readonly dispatchingTopics = new Set<string>();

  /**
   * Events published re-entrantly while their topic was mid-dispatch.
   * Drained (in order) once the current dispatch for that topic completes.
   */
  private readonly pendingEvents: DomainEvent[] = [];
  private readonly maxPendingEvents = 200;

  /**
   * Consecutive re-entrant dispatches per topic. Prevents a listener that
   * keeps re-publishing its own topic from spinning the event loop forever
   * (the queue alone would turn a stack overflow into an endless drain).
   */
  private readonly dispatchChains = new Map<string, number>();
  private readonly maxChainLength = 100;

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
    // Re-entrant publish of the same topic (a listener re-publishing what it
    // reacts to). Queue it and drain later instead of recursing — the old
    // synchronous recursion overflowed the call stack.
    if (this.dispatchingTopics.has(event.topic)) {
      this.queueReentrant(event);
      return;
    }

    this.dispatchingTopics.add(event.topic);
    try {
      await this.dispatchNow(event);
    } finally {
      this.dispatchingTopics.delete(event.topic);
      // A listener may have re-published this topic mid-dispatch; those
      // events were queued — deliver them now (in order, bounded).
      this.drainPending(event.topic);
    }
  }

  private async dispatchNow<T>(event: DomainEvent<T>): Promise<void> {
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

  /**
   * Queue an event published while its topic was already being dispatched.
   * The queue is bounded; beyond the cap the event is dropped with a warning
   * instead of spinning the event loop forever.
   */
  private queueReentrant(event: DomainEvent): void {
    if (this.pendingEvents.length >= this.maxPendingEvents) {
      this.logger.warn('Event bus re-entrant queue full; dropping event', {
        topic: event.topic,
        pending: this.pendingEvents.length,
      });
      return;
    }
    this.pendingEvents.push(event);
  }

  /**
   * Deliver queued re-entrant events for a topic once its outer dispatch
   * completes. Bounded per topic so a pathological listener (one that keeps
   * re-publishing its own topic on every delivery) cannot loop forever.
   */
  private drainPending(topic: string): void {
    const chain = (this.dispatchChains.get(topic) ?? 0) + 1;
    if (chain > this.maxChainLength) {
      this.dispatchChains.delete(topic);
      const dropped = this.pendingEvents.filter((e) => e.topic === topic).length;
      this.pendingEvents.splice(
        0,
        this.pendingEvents.length,
        ...this.pendingEvents.filter((e) => e.topic !== topic),
      );
      this.logger.error('Event bus re-entrant loop detected; dropped queued events', {
        topic,
        dropped,
        chain,
      });
      return;
    }
    this.dispatchChains.set(topic, chain);

    let next = this.pendingEvents.shift();
    while (next) {
      if (next.topic === topic) {
        // Fire-and-forget; a listener throwing must not break the drain.
        this.dispatchNow(next).catch((e: unknown) => {
          this.logger.error('Queued event dispatch failed', { topic, error: AppError.from(e) });
        });
      } else {
        this.pendingEvents.unshift(next);
        break;
      }
      next = this.pendingEvents.shift();
    }
    if (!this.pendingEvents.length) this.dispatchChains.delete(topic);
  }
}

export const createDefaultEventBus = (logger: ILogger) => new EventBus(logger);
