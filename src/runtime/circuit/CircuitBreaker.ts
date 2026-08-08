import { AppError } from '@/errors/AppError';
import { err } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import type { CircuitBreakerPolicy, CircuitState } from '../types';

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private nextAttemptAt = 0;

  constructor(
    private readonly name: string,
    private readonly policy: CircuitBreakerPolicy,
  ) {}

  get stateSnapshot(): CircuitState {
    return this.state;
  }

  getName(): string {
    return this.name;
  }

  async execute<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
    if (this.state === 'OPEN') {
      if (Date.now() >= this.nextAttemptAt) {
        this.state = 'HALF_OPEN';
        this.successes = 0;
      } else {
        return err(new AppError({
          message: `Circuit breaker ${this.name} is OPEN`,
          code: 'CIRCUIT_OPEN',
          retryable: true,
          fallbackAvailable: true,
        }));
      }
    }

    const result = await fn();
    this.record(result.success);
    return result;
  }

  private record(success: boolean): void {
    if (success) {
      if (this.state === 'HALF_OPEN') {
        this.successes++;
        if (this.successes >= this.policy.halfOpenMaxCalls) {
          this.state = 'CLOSED';
          this.failures = 0;
          this.successes = 0;
        }
      } else {
        this.failures = 0;
      }
      return;
    }

    this.failures++;
    if (this.failures >= this.policy.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptAt = Date.now() + this.policy.resetTimeoutMs;
      this.successes = 0;
    }
  }

  snapshot() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      nextAttemptAt: this.nextAttemptAt,
    };
  }
}

export function createCircuitBreakerPolicy(overrides?: Partial<CircuitBreakerPolicy>): CircuitBreakerPolicy {
  return {
    failureThreshold: overrides?.failureThreshold ?? 5,
    resetTimeoutMs: overrides?.resetTimeoutMs ?? 30_000,
    halfOpenMaxCalls: overrides?.halfOpenMaxCalls ?? 2,
  };
}
