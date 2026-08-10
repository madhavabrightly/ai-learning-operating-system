import { SUPABASE_ANON_KEY } from '@/constants/config';

/**
 * Anonymous-session bootstrap — simplified.
 *
 * Edge Function now has verify_jwt=false, so the gateway accepts the
 * publishable key directly. No GoTrue sign-in or session check is needed —
 * the key is returned synchronously.
 */

/**
 * Returns the publishable key for Edge Function calls.
 * The Supabase gateway accepts this directly (verify_jwt=false on the function).
 */
export function getAuthToken(): string {
  return SUPABASE_ANON_KEY;
}

/**
 * No-op stub retained for callers that still reference it.
 * Was previously needed for anonymous sign-in; now a no-op.
 */
export function ensureAuthSession(): Promise<boolean> {
  return Promise.resolve(true);
}