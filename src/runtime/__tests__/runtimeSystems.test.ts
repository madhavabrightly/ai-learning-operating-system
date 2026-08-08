import { describe, it, expect, vi } from 'vitest';
import { AppError } from '@/errors/AppError';
import { CircuitBreaker, createCircuitBreakerPolicy } from '../circuit/CircuitBreaker';
import { createRetryPolicy } from '../retry/RetryPolicy';
import { classifyError } from '../errors/ErrorClassifier';
import { ok, err } from '@/errors/ResultFactory';

describe('RetryPolicy', () => {
  it('retries transient errors up to maxRetries', () => {
    const policy = createRetryPolicy({ maxRetries: 3 });
    const error = new AppError({ message: 'timeout', code: 'TIMEOUT', retryable: true });
    expect(policy.shouldRetry(error, 0)).toBe(true);
    expect(policy.shouldRetry(error, 1)).toBe(true);
    expect(policy.shouldRetry(error, 2)).toBe(true);
    expect(policy.shouldRetry(error, 3)).toBe(false);
  });

  it('does not retry permanent errors', () => {
    const policy = createRetryPolicy({ maxRetries: 3 });
    const error = new AppError({ message: 'invalid input', code: 'VALIDATION_ERROR', retryable: false });
    expect(policy.shouldRetry(error, 0)).toBe(false);
  });

  it('calculates exponential backoff with a ceiling (incl. jitter)', () => {
    const policy = createRetryPolicy({ baseDelayMs: 100, maxDelayMs: 500, backoffMultiplier: 2 });
    // Jitter multiplier is 0.85–1.15, so the max observed delay is 575ms.
    const d1 = policy.calculateDelay(1);
    const d3 = policy.calculateDelay(3);
    expect(d1).toBeLessThanOrEqual(575);
    expect(d3).toBeLessThanOrEqual(575);
    expect(d1).toBeGreaterThanOrEqual(85);
  });
});

describe('CircuitBreaker', () => {
  it('opens after failure threshold and rejects while open', async () => {
    const breaker = new CircuitBreaker('test', createCircuitBreakerPolicy({ failureThreshold: 3, resetTimeoutMs: 5000 }));
    const fn = vi.fn(async () => err('boom', true));

    await breaker.execute(fn);
    await breaker.execute(fn);
    await breaker.execute(fn);
    expect(breaker.stateSnapshot).toBe('OPEN');

    const result = await breaker.execute(fn);
    expect(result.success).toBe(false);
    expect(breaker.stateSnapshot).toBe('OPEN');
    // fn not called again while open.
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('closes again after success in half-open', async () => {
    const breaker = new CircuitBreaker('test', createCircuitBreakerPolicy({ failureThreshold: 2, resetTimeoutMs: 1, halfOpenMaxCalls: 1 }));
    const fail = vi.fn(async () => err('boom', true));
    await breaker.execute(fail);
    await breaker.execute(fail);
    expect(breaker.stateSnapshot).toBe('OPEN');

    // Wait for reset timeout, then succeed in half-open.
    await new Promise((r) => setTimeout(r, 10));
    const succeed = vi.fn(async () => ok('good'));
    const result = await breaker.execute(succeed);
    expect(result.success).toBe(true);
    expect(breaker.stateSnapshot).toBe('CLOSED');
  });
});

describe('ErrorClassifier', () => {
  it('classifies timeout as transient', () => {
    const c = classifyError(new AppError({ message: 'request timed out', code: 'TIMEOUT', retryable: true }));
    expect(c.category).toBe('TRANSIENT');
    expect(c.retry).toBe(true);
  });

  it('classifies validation as permanent', () => {
    const c = classifyError(new AppError({ message: 'invalid file', code: 'VALIDATION_ERROR' }));
    expect(c.category).toBe('VALIDATION');
    expect(c.retry).toBe(false);
  });

  it('infers AI provider category from message', () => {
    const c = classifyError(new AppError({ message: 'the llm provider failed' }));
    expect(c.category).toBe('AI_PROVIDER');
  });
});
