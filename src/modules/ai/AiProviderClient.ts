import { AppError } from '@/errors/AppError';
import { SUPABASE_URL, OPENROUTER_FUNCTION, OPENROUTER_DEFAULT_MODEL, AI_RETRY } from '@/constants/config';
import { getAuthToken } from '@/services/authSession';
import { buildChatPrompt, buildStructuredPrompt } from '@/modules/ai/promptBuilder';

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
  /** Reasoning/thinking tokens from reasoning models (delta.reasoning / delta.reasoning_content). */
  onReasoningDelta?: (delta: string) => void;
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
  /** Generate learning content (questions/quiz/flashcards) from document text. */
  learn(input: { documentId: string; text: string; kind: 'questions' | 'quiz' | 'flashcards'; count?: number; difficulty?: string }): Promise<unknown>;
  research(query: string, url?: string, maxResults?: number): Promise<ResearchResult>;
  health(): Promise<{ status: string; config: Record<string, unknown> }>;
}

// ---------------------------------------------------------------------------
// Edge Function transport helpers
// ---------------------------------------------------------------------------

const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/${OPENROUTER_FUNCTION}`;

function endpoint(): string {
  return FUNCTION_URL;
}

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${getAuthToken()}`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
  // attempt 0 -> ~1s, attempt 1 -> ~2s (+ jitter)
  const base = AI_RETRY.BASE_DELAY_MS * 2 ** attempt;
  const jitter = Math.random() * AI_RETRY.MAX_JITTER_MS;
  return base + jitter;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function withRetry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const error = AppError.from(e);
    const retryable = error.retryable || (error instanceof AppError && error.code === 'NETWORK_ERROR');
    if (retryable && attempt + 1 < AI_RETRY.MAX_ATTEMPTS) {
      await sleep(backoffDelay(attempt));
      return withRetry(fn, attempt + 1);
    }
    throw error;
  }
}

interface EdgeErrorBody {
  error?: { message?: string; retryable?: boolean };
}

async function parseError(res: Response): Promise<AppError> {
  let message = `AI service error (${res.status})`;
  let retryable = isRetryableStatus(res.status);
  try {
    const body = (await res.json()) as EdgeErrorBody;
    if (body.error?.message) message = body.error.message;
    if (typeof body.error?.retryable === 'boolean') retryable = body.error.retryable;
  } catch {
    // fall through to generic message
  }
  return new AppError({ message, code: 'AI_SERVICE_ERROR', retryable });
}

/** Parsed content from a single OpenRouter SSE delta frame. */
interface SseDelta {
  content: string;
  reasoning: string;
}

/**
 * Parse an OpenRouter SSE frame into content + reasoning deltas.
 * Returns null for [DONE] or unparseable frames (stream end / error).
 * Reasoning models (e.g. via Novita) stream their thinking in
 * `delta.reasoning` (OpenRouter spec) or `delta.reasoning_content`
 * (DeepSeek-style providers) with `delta.content` empty — both are captured
 * so the UI can surface the thinking phase instead of a blank stream.
 */
function parseSseFrame(line: string): SseDelta | null {
  if (!line.startsWith('data:')) return null;
  const payload = line.slice(5).trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    const parsed = JSON.parse(payload) as {
      choices?: { delta?: { content?: string; reasoning?: string; reasoning_content?: string } }[];
    };
    const delta = parsed.choices?.[0]?.delta;
    if (!delta) return { content: '', reasoning: '' };
    const reasoning =
      typeof delta.reasoning === 'string'
        ? delta.reasoning
        : typeof delta.reasoning_content === 'string'
          ? delta.reasoning_content
          : '';
    return {
      content: typeof delta.content === 'string' ? delta.content : '',
      reasoning,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createAiProviderClient(_client?: unknown, fetchImpl?: typeof fetch): AiProviderClient {
  const doFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  const baseUrl = endpoint();

  return {
    async chat(request) {
      if (!doFetch) {
        throw new AppError({ message: 'fetch not available', code: 'NETWORK_ERROR', retryable: true });
      }
      const { messages, context } = request;
      const userContent = messages[messages.length - 1]?.content ?? '';
      const { messages: built } = buildChatPrompt({ grounding: context, history: messages.slice(0, -1), userContent });

      return withRetry(async () => {
        const res = await doFetch(baseUrl, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            model: OPENROUTER_DEFAULT_MODEL,
            messages: built,
            temperature: request.temperature ?? 0.3,
            max_tokens: request.maxTokens ?? 4000,
            stream: false,
          }),
        });
        if (!res.ok) throw await parseError(res);
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string') {
          throw new AppError({ message: 'AI returned an empty response', code: 'AI_EMPTY_RESPONSE', retryable: true });
        }
        return { role: 'assistant' as const, content };
      });
    },

    async streamChat(request, callbacks) {
      if (!doFetch) {
        callbacks.onError?.(new AppError({ message: 'fetch not available', code: 'NETWORK_ERROR', retryable: true }));
        return;
      }
      const { messages, context } = request;
      const userContent = messages[messages.length - 1]?.content ?? '';
      const { messages: built } = buildChatPrompt({ grounding: context, history: messages.slice(0, -1), userContent });

      let attempt = 0;
      const tryStream = async (): Promise<void> => {
        let res: Response;
        try {
          res = await doFetch(baseUrl, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              model: OPENROUTER_DEFAULT_MODEL,
              messages: built,
              temperature: request.temperature ?? 0.3,
              max_tokens: request.maxTokens ?? 4000,
              stream: true,
            }),
            signal: callbacks.signal,
          });
        } catch (e) {
          if (callbacks.signal?.aborted) {
            callbacks.onError?.(new AppError({ message: 'Streaming cancelled', code: 'CANCELLED', retryable: false }));
            return;
          }
          if (attempt + 1 < AI_RETRY.MAX_ATTEMPTS) {
            attempt += 1;
            await sleep(backoffDelay(attempt - 1));
            return tryStream();
          }
          callbacks.onError?.(AppError.from(e));
          return;
        }

        if (!res.ok) {
          const error = await parseError(res);
          if (isRetryableStatus(res.status) && attempt + 1 < AI_RETRY.MAX_ATTEMPTS) {
            attempt += 1;
            await sleep(backoffDelay(attempt - 1));
            return tryStream();
          }
          callbacks.onError?.(error);
          return;
        }

        if (!res.body) {
          callbacks.onError?.(new AppError({ message: 'Empty response body', code: 'NETWORK_ERROR', retryable: true }));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let completed = false;

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const frames = buffer.split('\n\n');
            buffer = frames.pop() ?? '';
            for (const frame of frames) {
              for (const line of frame.split('\n')) {
                if (!line.startsWith('data:')) continue;
                const delta = parseSseFrame(line);
                if (delta === null) {
                  completed = true;
                  continue;
                }
                if (delta.reasoning) callbacks.onReasoningDelta?.(delta.reasoning);
                if (delta.content) callbacks.onDelta(delta.content);
              }
            }
          }
          if (buffer.trim()) {
            const line = buffer.trim();
            if (line.startsWith('data:')) {
              const delta = parseSseFrame(line);
              if (delta === null) {
                completed = true;
              } else {
                if (delta.reasoning) callbacks.onReasoningDelta?.(delta.reasoning);
                if (delta.content) callbacks.onDelta(delta.content);
              }
            }
          }
          callbacks.onDone?.();
        } catch (e) {
          if (callbacks.signal?.aborted) {
            callbacks.onError?.(new AppError({ message: 'Streaming cancelled', code: 'CANCELLED', retryable: false }));
            return;
          }
          // Mid-stream network failure — retry from scratch is unsafe (partial
          // text already delivered), so surface the error to the UI.
          callbacks.onError?.(AppError.from(e));
        }
      };

      await tryStream();
    },

    async action(request) {
      const intentPrompts: Record<AiActionIntent, string> = {
        explain: 'Explain the selected material clearly, with context and reasoning.',
        simplify: 'Explain the selected material in simple, plain language.',
        summarize: 'Summarize the selected material into the key points.',
        teach: 'Teach me the selected material step by step as a tutor.',
        example: 'Provide concrete examples illustrating the selected material.',
        compare: 'Compare and contrast the ideas in the selected material.',
        questions: 'Generate review questions about the selected material.',
        quiz: 'Generate a short quiz about the selected material.',
        flashcards: 'Generate flashcards from the selected material.',
        notes: 'Turn the selected material into clean, structured study notes.',
      };
      const userContent = request.messages?.[request.messages.length - 1]?.content ?? request.context?.selection ?? request.context?.sections?.[0]?.text ?? '';
      const prompt = `${intentPrompts[request.intent]}\n\nMaterial:\n${userContent}`;
      return this.chat({ messages: [{ role: 'user', content: prompt }], context: request.context, temperature: 0.3 });
    },

    async extractConcepts(documentId, text) {
      return this.chat({
        messages: [
          {
            role: 'user',
            content: `Extract the key concepts from this document and return them as a JSON array of {label, description, difficulty}. Do not wrap in markdown.\n\n${text.slice(0, 6000)}`,
          },
        ],
        temperature: 0.2,
        maxTokens: 800,
      }).then((r) => {
        try {
          return JSON.parse(r.content) as unknown;
        } catch {
          throw new AppError({ message: 'Could not parse concept extraction JSON', code: 'JSON_PARSE_ERROR', retryable: false });
        }
      });
    },

    async learn(input) {
      const { documentId, text, kind, count, difficulty } = input;
      const prompt = buildStructuredPrompt({ kind, text, count, difficulty });

      const attempt = async (repair: boolean): Promise<string> => {
        const body: Record<string, unknown> = {
          model: OPENROUTER_DEFAULT_MODEL,
          messages: [
            {
              role: 'user',
              content: repair
                ? `${prompt}\n\nYour previous response was not valid JSON. Respond again with ONLY valid JSON, nothing else.`
                : prompt,
            },
          ],
          temperature: 0.2,
          max_tokens: 2000,
          stream: false,
          format: 'json',
        };
        return withRetry(async () => {
          const res = await doFetch(baseUrl, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(body),
          });
          if (!res.ok) throw await parseError(res);
          const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
          return data.choices?.[0]?.message?.content ?? '';
        });
      };

      const parse = (raw: string): unknown => {
        const cleaned = raw
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/, '');
        const start = cleaned.indexOf('[');
        const end = cleaned.lastIndexOf(']');
        if (start === -1 || end === -1 || end <= start) {
          throw new AppError({ message: 'Model did not return a JSON array', code: 'JSON_PARSE_ERROR', retryable: false });
        }
        try {
          return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
        } catch {
          throw new AppError({ message: 'Model returned malformed JSON', code: 'JSON_PARSE_ERROR', retryable: false });
        }
      };

      let raw = await attempt(false);
      try {
        return parse(raw);
      } catch {
        // One repair retry, then surface the error — no fabricated fallback data.
        raw = await attempt(true);
        return parse(raw);
      }
    },

    async research(query, url, maxResults) {
      // Research runs through the Bright Data pipeline (WebUrlFetcher + backend).
      // If the backend is unreachable this surfaces an error result — never
      // fabricated evidence.
      throw new AppError({
        message: 'Research backend is not reachable from this environment.',
        code: 'RESEARCH_UNAVAILABLE',
        retryable: false,
      });
    },

    async health() {
      return { status: 'ok', config: { provider: 'openrouter', model: OPENROUTER_DEFAULT_MODEL } };
    },
  };
}
