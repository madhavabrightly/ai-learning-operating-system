import { AppError } from '@/errors/AppError';
import { classifyError } from '../errors/ErrorClassifier';
import type { ErrorCategory, RetryPolicy } from '../types';

export function createRetryPolicy(
  overrides?: Partial<RetryPolicy>,
  categoryOverrides?: Partial<Record<ErrorCategory, boolean>>,
): RetryPolicy {
  const policy: RetryPolicy = {
    maxRetries: overrides?.maxRetries ?? 3,
    baseDelayMs: overrides?.baseDelayMs ?? 250,
    maxDelayMs: overrides?.maxDelayMs ?? 30_000,
    backoffMultiplier: overrides?.backoffMultiplier ?? 2,
    retryableCategories: overrides?.retryableCategories ?? ['TRANSIENT', 'NETWORK', 'AI_PROVIDER', 'OCR', 'PARSER', 'DATABASE', 'PLUGIN'],
    calculateDelay(attempt: number): number {
      const jitter = Math.random() * 0.3 + 0.85;
      const delay = Math.min(
        policy.baseDelayMs * policy.backoffMultiplier ** attempt,
        policy.maxDelayMs,
      );
      return Math.round(delay * jitter);
    },
    shouldRetry(error: AppError, attempt: number): boolean {
      if (attempt >= policy.maxRetries) return false;
      const classification = classifyError(error);
      const categoryAllowed = categoryOverrides?.[classification.category] ?? policy.retryableCategories.includes(classification.category);
      return classification.retry && categoryAllowed;
    },
  };
  return policy;
}

export const DEFAULT_RETRY_POLICY = createRetryPolicy();
