import { supabase } from '@/config/SupabaseConfig';

export interface FetchPageOptions {
  url: string;
  format?: 'raw';
}

export interface FetchPageResult {
  content: string;
  url: string;
}

export class BrightDataError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'BrightDataError';
  }
}

/**
 * Session bootstrap — no-op.
 * Edge Functions now accept the publishable key directly (verify_jwt=false).
 */
async function ensureAnonymousSession(): Promise<void> {
  // no-op
}

function coerceToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof ArrayBuffer) return new TextDecoder('utf-8').decode(value);
  if (value && typeof value === 'object') {
    return (value as { content?: unknown }).content?.toString() ?? JSON.stringify(value);
  }
  return String(value ?? '');
}

export async function fetchPageContent(url: string): Promise<FetchPageResult> {
  let targetUrl: URL;
  try {
    targetUrl = new URL(url);
  } catch {
    throw new BrightDataError('Please enter a valid URL including https://');
  }

  if (!['http:', 'https:'].includes(targetUrl.protocol)) {
    throw new BrightDataError('Only http and https URLs are allowed');
  }

  await ensureAnonymousSession();

  const { data, error } = await supabase.functions.invoke<{
    content?: string;
    error?: string;
  }>('bright-data-proxy', {
    body: { url: targetUrl.toString(), format: 'raw' },
  });

  if (error) {
    throw new BrightDataError(error.message);
  }

  if (!data) {
    throw new BrightDataError('Empty response from document fetcher');
  }

  if (data.error) {
    throw new BrightDataError(data.error);
  }

  return {
    url: targetUrl.toString(),
    content: coerceToString(data.content ?? data),
  };
}
