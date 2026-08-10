import { AppError } from '@/errors/AppError';
import { getAuthToken } from '@/services/authSession';

export interface BackendClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * HTTP client for the backend API.
 * Used by AiProviderClient, GraphExtractor, and other services.
 *
 * Every request carries `Authorization: Bearer <token>` — the active session
 * token when available, otherwise the publishable key (see authSession.ts).
 */
export class BackendHttpClient {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(options: BackendClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.doFetch = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  }

  getBackendUrl(): string {
    return this.baseUrl;
  }

  private async headers(extra?: Record<string, string>): Promise<Record<string, string>> {
    const token = await getAuthToken();
    return { ...(extra ?? {}), Authorization: `Bearer ${token}` };
  }

  async get<T = unknown>(path: string): Promise<T> {
    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      headers: await this.headers(),
    });
    if (!res.ok) {
      throw new AppError({
        message: `Backend GET ${path} failed (${res.status})`,
        code: 'BACKEND_ERROR',
        retryable: res.status >= 500,
      });
    }
    return res.json() as Promise<T>;
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: await this.headers({ 'Content-Type': 'application/json' }),
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      let message = `Backend POST ${path} failed (${res.status})`;
      try {
        const data = (await res.json()) as { error?: { message?: string } };
        if (data.error?.message) message = data.error.message;
      } catch {
        // ignore parse errors
      }
      throw new AppError({
        message,
        code: 'BACKEND_ERROR',
        retryable: res.status >= 500,
      });
    }
    return res.json() as Promise<T>;
  }

  async delete(path: string): Promise<void> {
    const res = await this.doFetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: await this.headers(),
    });
    if (!res.ok) {
      throw new AppError({
        message: `Backend DELETE ${path} failed (${res.status})`,
        code: 'BACKEND_ERROR',
        retryable: res.status >= 500,
      });
    }
  }
}
