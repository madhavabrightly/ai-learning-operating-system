import type { ILogger } from './ILogger';

interface Timing {
  label: string;
  start: number;
  end?: number;
  duration?: number;
}

export class PerformanceTimer {
  private active = new Map<string, Timing>();
  private completed: Timing[] = [];
  private readonly maxCompleted = 100;

  constructor(private logger: ILogger) {}

  start(label: string): string {
    const id = `${label}-${Date.now()}`;
    this.active.set(id, { label, start: performance.now() });
    return id;
  }

  end(id: string): Timing | undefined {
    const timing = this.active.get(id);
    if (!timing) return undefined;
    timing.end = performance.now();
    timing.duration = timing.end - timing.start;
    this.active.delete(id);
    this.completed.push(timing);
    if (this.completed.length > this.maxCompleted) this.completed.shift();
    this.logger.debug('Performance timing', { label: timing.label, durationMs: Math.round(timing.duration) });
    return timing;
  }

  measure<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const id = this.start(label);
    return fn().finally(() => this.end(id));
  }

  getActive(): Timing[] {
    return [...this.active.values()].map((t) => ({ ...t, duration: performance.now() - t.start }));
  }

  getCompleted(): Timing[] {
    return [...this.completed];
  }

  getStats(): { active: number; completed: number; averageDurationMs: number; maxDurationMs: number } {
    const durations = this.completed.map((t) => t.duration ?? 0);
    return {
      active: this.active.size,
      completed: this.completed.length,
      averageDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
      maxDurationMs: durations.length ? Math.max(...durations) : 0,
    };
  }
}
