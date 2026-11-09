import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DB_TIMEOUT_MS = 10_000;
const ROOM_TIMEOUT_MS = 15_000;
const SLOW_MS = 1_500;

// A stalled request gives up and retries instead of hanging the screen.
const timed: typeof fetch = (input, init) => {
  const limit = AbortSignal.timeout(DB_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, limit]) : limit });
};

let client: SupabaseClient | undefined;

export function supabase(): SupabaseClient {
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { fetch: timed },
  });
  return client;
}

// An invisible anonymous login: it is what lets database rules tell people apart.
export async function ensureUser(): Promise<{ id: string; token: string }> {
  const auth = supabase().auth;
  const { data } = await auth.getSession();
  if (data.session) return { id: data.session.user.id, token: data.session.access_token };
  const { data: signedIn, error } = await auth.signInAnonymously();
  if (error || !signedIn.session) throw new Error("Could not connect. Try again in a moment.");
  return { id: signedIn.session.user.id, token: signedIn.session.access_token };
}

// Status 0 means the request never got an answer.
export class RoomError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function room<T = unknown>(action: string, body: Record<string, unknown> = {}, retry = true): Promise<T> {
  const { token } = await ensureUser();
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch("/api/room", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...body }),
      signal: AbortSignal.timeout(ROOM_TIMEOUT_MS),
    });
  } catch {
    throw new RoomError("The connection is slow. Try again.", 0);
  }
  const ms = performance.now() - started;
  if (ms > SLOW_MS && action !== "report" && typeof body.sessionId === "string") {
    report(body.sessionId, "slow", { action, status: res.status }, ms);
  }
  if (res.status === 401 && retry) {
    // Usually a token that expired while the phone slept, so renew it and keep the same identity.
    // Only a login that can't be renewed, such as one the cleanup job removed, starts afresh.
    const { data, error } = await supabase().auth.refreshSession();
    if (error?.name === "AuthRetryableFetchError") throw new RoomError("The connection is slow. Try again.", 0);
    if (error || !data.session) await supabase().auth.signOut({ scope: "local" });
    return room<T>(action, body, false);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new RoomError(json.error ?? "Something went wrong.", res.status);
  return json as T;
}

// Tells the session timeline about a problem on this phone. Never throws.
export function report(sessionId: string, kind: "swipe_failed" | "ready_failed" | "mark_failed" | "slow", detail: Record<string, unknown> = {}, ms?: number) {
  room("report", { sessionId, kind, detail, ms }).catch(() => {});
}
