import { supabase, isSupabaseConfigured } from '@/config/SupabaseConfig';

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

let signedInAnonymously = false;

async function ensureAnonymousSession(): Promise<void> {
  if (signedInAnonymously) return;
  if (!isSupabaseConfigured() || !supabase) {
    throw new BrightDataError(
      'Supabase is not configured (VITE_SUPABASE_ANON_KEY missing). Web fetching requires the bright-data-proxy Edge Function.',
    );
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) {
    signedInAnonymously = true;
    return;
  }
  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new BrightDataError(`Could not start session: ${error.message}`);
  }
  signedInAnonymously = true;
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

  if (!supabase) {
    throw new BrightDataError('Supabase is not configured');
  }

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
