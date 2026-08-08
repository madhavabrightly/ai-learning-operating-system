import type { AppErrorInput } from './types';

export class AppError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly fallbackAvailable: boolean;
  readonly cause?: unknown;

  constructor(input: AppErrorInput) {
    super(input.message);
    this.name = 'AppError';
    this.code = input.code ?? 'APP_ERROR';
    this.retryable = input.retryable ?? false;
    this.fallbackAvailable = input.fallbackAvailable ?? false;
    this.cause = input.cause;
  }

  static from(err: unknown): AppError {
    if (err instanceof AppError) return err;
    if (err instanceof Error) {
      return new AppError({ message: err.message, cause: err });
    }
    return new AppError({ message: String(err) });
  }
}
