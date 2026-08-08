import { AppError } from './AppError';
import type { Result } from './types';

export function ok<T>(data: T, fallbackAvailable = false): Result<T> {
  return { success: true, data, error: undefined, retryable: false, fallbackAvailable };
}

export function err<T = never>(
  error: string | AppError,
  retryable = false,
): Result<T> {
  const message = error instanceof AppError ? error.message : error;
  const rb = error instanceof AppError ? error.retryable : retryable;
  const fb = error instanceof AppError ? error.fallbackAvailable : false;
  return { success: false, data: undefined, error: message, retryable: rb, fallbackAvailable: fb };
}

export async function fromPromise<T>(
  fn: () => Promise<T>,
  options?: { retryable?: boolean; fallbackAvailable?: boolean },
): Promise<Result<T>> {
  try {
    const data = await fn();
    return ok(data, options?.fallbackAvailable ?? false);
  } catch (error) {
    return err(AppError.from(error), options?.retryable ?? false);
  }
}
