import { createClient, SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_URL = 'https://subtsxwbxlyinuspakec.supabase.co';

/**
 * Creates a Supabase client only when an anon key is configured.
 * Returns null when `VITE_SUPABASE_ANON_KEY` is missing so the app can
 * boot without Supabase (document fetching/research then falls back to
 * the local backend or fails clearly). This module must never throw at
 * import time — a missing key is a configuration state, not a crash.
 */
export function createSupabaseClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  });
}

export const supabase = createSupabaseClient();

/** True when a Supabase client is available for research/proxy usage. */
export function isSupabaseConfigured(): boolean {
  return supabase !== null;
}
