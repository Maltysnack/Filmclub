import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

export function supabase(): SupabaseClient {
  client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
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

export async function room<T = unknown>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { token } = await ensureUser();
  const res = await fetch("/api/room", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
  return json as T;
}
