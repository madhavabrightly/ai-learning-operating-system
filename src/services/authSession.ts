import { supabase } from '@/config/SupabaseConfig';
import { SUPABASE_ANON_KEY } from '@/constants/config';

/**
 * Anonymous-session bootstrap.
 *
 * Edge Functions are JWT-gated by the platform (verify_jwt=true). The durable
 * pattern is a real session token: we sign in anonymously on first load so
 * every AI/backend call carries a valid user JWT instead of relying on a
 * static key. If anonymous sign-ins are not enabled on the project yet, we
 * fall back to the publishable key so requests keep working.
 */

let initPromise: Promise<boolean> | null = null;

/**
 * Ensures the Supabase client has a session, creating an anonymous one on
 * first call if needed. Idempotent — the sign-in only runs once per page
 * load, and it never throws: a failure just means callers fall back to the
 * publishable key.
 */
export function ensureAuthSession(): Promise<boolean> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session) return true;

        const { error } = await supabase.auth.signInAnonymously();
        if (error) {
          console.warn('[auth] anonymous sign-in unavailable:', error.message);
          return false;
        }
        return true;
      } catch (e) {
        console.warn('[auth] session bootstrap failed:', e);
        return false;
      }
    })();
  }
  return initPromise;
}

/**
 * Resolves the Bearer token for Edge Function calls:
 * 1. the active session's access token when present, else
 * 2. the publishable key (accepted by the functions gateway as a fallback).
 */
export async function getAuthToken(): Promise<string> {
  await ensureAuthSession();
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) return session.access_token;
  } catch {
    // ignore — fall through to the publishable key
  }
  return SUPABASE_ANON_KEY;
}
