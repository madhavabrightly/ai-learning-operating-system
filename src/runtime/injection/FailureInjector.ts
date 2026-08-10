import { AppError } from '@/errors/AppError';

export class FailureInjector {
  private enabled = false;
  private failureRates = new Map<string, number>();

  /** Set failure rate (0–1) for a given worker type. */
  setRate(workerType: string, rate: number): void {
    this.failureRates.set(workerType, Math.max(0, Math.min(1, rate)));
  }

  /** Enable or disable failure injection entirely. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Toggle the enabled state. */
  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get rates(): ReadonlyMap<string, number> {
    return this.failureRates;
  }

  /** Returns an AppError to inject, or undefined if no failure should happen. */
  maybeInject(workerType: string): AppError | undefined {
    if (!this.enabled) return undefined;
    const rate = this.failureRates.get(workerType) ?? 0;
    if (rate <= 0 || Math.random() > rate) return undefined;
    return new AppError({
      message: `Injected failure for ${workerType}`,
      code: 'INJECTED_FAILURE',
      retryable: true,
      fallbackAvailable: true,
    });
  }
}