import type { BackendHttpClient } from '@/services/BackendClient';
import { AppError } from '@/errors/AppError';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroundedSource {
  url: string;
  title: string;
  text: string;
  retrievedAt: number;
}

export interface GroundingContext {
  documentId?: string;
  documentTitle?: string;
  pages?: { page: number; text: string }[];
  selection?: string;
  sections?: { title: string; text: string; page: number }[];
  formulas?: { id: string; tex: string; page: number }[];
  tables?: { id: string; page: number; rows: string[][] }[];
  sources?: GroundedSource[];
  retrievedAt?: number;
}

export interface ChatRequest {
  conversationId?: string;
  messages: AiChatMessage[];
  context?: GroundingContext;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatResponse {
  role: 'assistant';
  content: string;
}

export type AiActionIntent =
  | 'explain'
  | 'simplify'
  | 'summarize'
  | 'teach'
  | 'example'
  | 'compare'
  | 'questions'
  | 'quiz'
  | 'flashcards'
  | 'notes';

export interface ActionRequest {
  intent: AiActionIntent;
  context?: GroundingContext;
  messages?: AiChatMessage[];
}

export interface StreamCallbacks {
  onDelta: (delta: string) => void;
  onDone?: () => void;
  onError?: (error: AppError) => void;
  signal?: AbortSignal;
}

export interface ResearchEvidence {
  sourceId: string;
  url: string;
  title: string;
  domain: string;
  retrievedAt: number;
  relevantText: string;
  confidence: number;
  requestId: string;
}

export interface ResearchResult {
  requestId: string;
  query: string;
  evidence: ResearchEvidence[];
  mechanism: 'brightdata' | 'direct-fetch' | 'error';
  error?: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface AiProviderClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest, callbacks: StreamCallbacks): Promise<void>;
  action(request: ActionRequest): Promise<ChatResponse>;
  extractConcepts(documentId: string, text: string): Promise<unknown>;
  research(query: string, url?: string, maxResults?: number): Promise<ResearchResult>;
  health(): Promise<{ status: string; config: Record<string, unknown> }>;
}

export function createAiProviderClient(client: BackendHttpClient, fetchImpl?: typeof fetch): AiProviderClient {
  const doFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);

  return {
    async chat(request) {
      return client.post<ChatResponse>('/api/ai/chat', request);
    },

    async streamChat(request, callbacks) {
      if (!doFetch) {
        callbacks.onError?.(new AppError({ message: 'fetch not available', code: 'NETWORK_ERROR', retryable: true }));
        return;
      }
      const base = client.getBackendUrl();
      try {
        const res = await doFetch(`${base}/api/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...request, stream: true }),
          signal: callbacks.signal,
        });

        if (!res.ok) {
          let message = `Backend error (${res.status})`;
          try {
            const body = (await res.json()) as { error?: { message?: string; code?: string } };
            if (body.error?.message) message = body.error.message;
          } catch {
            // ignore
          }
          callbacks.onError?.(new AppError({ message, code: 'BACKEND_ERROR', retryable: res.status >= 500 }));
          return;
        }

        if (!res.body) {
          callbacks.onError?.(new AppError({ message: 'Empty response body', code: 'NETWORK_ERROR', retryable: true }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const lines = frame.split('\n');
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (!payload) continue;
              try {
                const parsed = JSON.parse(payload) as { delta?: string };
                if (parsed.delta) callbacks.onDelta(parsed.delta);
              } catch {
                // Ignore malformed SSE frames.
              }
            }
          }
        }
        callbacks.onDone?.();
      } catch (e) {
        if (callbacks.signal?.aborted) {
          callbacks.onError?.(new AppError({ message: 'Streaming cancelled', code: 'CANCELLED', retryable: false }));
          return;
        }
        callbacks.onError?.(AppError.from(e));
      }
    },

    async action(request) {
      return client.post<ChatResponse>('/api/ai/action', request);
    },

    async extractConcepts(documentId, text) {
      return client.post('/api/ai/extract', { documentId, text });
    },

    async research(query, url, maxResults) {
      return client.post<ResearchResult>('/api/research', { query, url, maxResults });
    },

    async health() {
      return client.get('/api/health');
    },
  };
}
