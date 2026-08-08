export interface Result<T, E = string> {
  success: boolean;
  data?: T;
  error?: E;
  retryable: boolean;
  fallbackAvailable: boolean;
}

export interface AppErrorInput {
  message: string;
  code?: string;
  retryable?: boolean;
  fallbackAvailable?: boolean;
  cause?: unknown;
}
