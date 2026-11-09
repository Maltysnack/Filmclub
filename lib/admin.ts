import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const TIMEOUT_MS = 8_000;

// A stalled database fails fast instead of holding a request until the platform kills it.
const timed: typeof fetch = (input, init) => {
  const limit = AbortSignal.timeout(TIMEOUT_MS);
  return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, limit]) : limit });
};

let client: SupabaseClient | undefined;

export function admin(): SupabaseClient {
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: timed },
  });
  return client;
}
