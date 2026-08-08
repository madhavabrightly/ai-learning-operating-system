import { AppError } from '@/errors/AppError';
import type { AppConfig } from '@/config/AppConfig';

export interface BackendErrorBody {
  error?: { code?: string; message?: string };
}

export interface BackendClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Typed HTTP client for the local backend. All AI/research calls go through
 * this; the frontend never holds provider secrets.
 */
export class BackendHttpClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: BackendClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  getBackendUrl(): string {
    return this.baseUrl;
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async get<T = unknown>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.fetchImpl) {
      throw new AppError({ message: 'fetch is not available', code: 'NETWORK_ERROR', retryable: true });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        let errBody: BackendErrorBody | undefined;
        try {
          errBody = (await res.json()) as BackendErrorBody;
        } catch {
          // Non-JSON error body.
        }
        const message = errBody?.error?.message ?? `Backend request failed (${res.status})`;
        const code = errBody?.error?.code ?? 'BACKEND_ERROR';
        const retryable = res.status >= 500;
        throw new AppError({ message, code, retryable, fallbackAvailable: false });
      }

      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof AppError) throw e;
      const appErr = AppError.from(e);
      if (appErr.message.toLowerCase().includes('abort')) {
        throw new AppError({ message: 'Backend request timed out', code: 'TIMEOUT', retryable: true });
      }
      throw appErr;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createBackendClient(config: AppConfig): BackendHttpClient {
  return new BackendHttpClient({ baseUrl: config.backendUrl });
}
