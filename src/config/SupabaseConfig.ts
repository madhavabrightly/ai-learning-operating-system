import { createClient, SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_URL = 'https://subtsxwbxlyinuspakec.supabase.co';

export function createSupabaseClient(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL || DEFAULT_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!key) {
    throw new Error(
      'Missing VITE_SUPABASE_ANON_KEY. Set it via your preview/build environment variables and restart the dev server.',
    );
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
