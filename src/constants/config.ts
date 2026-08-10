// ---------------------------------------------------------------------------
// Publishable configuration constants
// These values are safe to embed in the client — Supabase anon keys are
// designed for public use (RLS protects data). Environment variable overrides
// let you point at a different project or model without re-building.
// ---------------------------------------------------------------------------

export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://subtsxwbxlyinuspakec.supabase.co';

/**
 * Publishable key (sb_publishable_...) — the modern successor to the anon key.
 * This project's platform rejects legacy anon JWTs for Edge Function calls
 * (UNAUTHORIZED_LEGACY_JWT), so the publishable key is required.
 */
export const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'sb_publishable_5P-e4CF3HsmhR-tqRX_RhA_Pe2imbZ2';

/** Name of the deployed Supabase Edge Function that proxies OpenRouter. */
export const OPENROUTER_FUNCTION = 'openrouter-chat';

/** Default OpenRouter model — free, 1.3B active params, 262k context. */
export const OPENROUTER_DEFAULT_MODEL = import.meta.env.VITE_OPENROUTER_MODEL ?? 'inclusionai/ling-3.0-tiny:free';

/**
 * Model used for structured JSON tasks (quiz/flashcards/questions and
 * knowledge-graph extraction). MUST be a capable instruction-tuned model that
 * does NOT burn its token budget on reasoning: the default chat model
 * (ling-3.0-tiny) is a reasoning model that spends its entire max_tokens on
 * "thinking" for complex prompts and returns empty content. Gemma 4 26B A4B
 * advertises response_format + structured_outputs on OpenRouter, so the
 * edge function's format:'json' → response_format mapping works with it.
 */
export const OPENROUTER_STRUCTURED_MODEL =
  import.meta.env.VITE_OPENROUTER_STRUCTURED_MODEL ?? 'google/gemma-4-26b-a4b-it:free';

/** Max chat context budget (in approximate tokens). */
export const CONTEXT_BUDGET = {
  SYSTEM_PROMPT: 500,
  GROUND_CONTEXT: 9_000,
  HISTORY: 2_000,
  CURRENT: 500,
  MAX_TOTAL: 12_000,
} as const;

/** Number of recent (user + assistant) *rounds* kept in history. */
export const HISTORY_KEEP_ROUNDS = 6;

/** Retry settings for the AI client. */
export const AI_RETRY = {
  MAX_ATTEMPTS: 3, // initial + 2 retries
  BASE_DELAY_MS: 1_000,
  MAX_JITTER_MS: 250,
} as const;