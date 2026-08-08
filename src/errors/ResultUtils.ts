import type { Result } from './types';
import { ok, err } from './ResultFactory';

export function mapResult<T, U>(result: Result<T>, fn: (data: T) => U): Result<U> {
  if (!result.success || result.data === undefined) {
    return {
      success: false,
      error: result.error,
      retryable: result.retryable,
      fallbackAvailable: result.fallbackAvailable,
    };
  }
  return ok(fn(result.data), result.fallbackAvailable);
}

export async function flatMapResultAsync<T, U>(
  result: Result<T>,
  fn: (data: T) => Promise<Result<U>>,
): Promise<Result<U>> {
  if (!result.success || result.data === undefined) {
    return {
      success: false,
      error: result.error,
      retryable: result.retryable,
      fallbackAvailable: result.fallbackAvailable,
    };
  }
  return fn(result.data);
}

export function matchResult<T, U>(
  result: Result<T>,
  handlers: {
    ok: (data: T) => U;
    err: (error: string | undefined) => U;
  },
): U {
  if (result.success && result.data !== undefined) {
    return handlers.ok(result.data);
  }
  return handlers.err(result.error);
}

export function combineResults<T>(results: Result<T>[]): Result<T[]> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.success) return err(result.error ?? 'Combined result failed', result.retryable);
    if (result.data !== undefined) values.push(result.data);
  }
  return ok(values);
}
