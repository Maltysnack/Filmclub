// Two real people through the real API and realtime. Needs `supabase start` and the dev server on 3100.
import { readFileSync, existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

const env = existsSync(".env.development.local")
  ? Object.fromEntries(readFileSync(".env.development.local", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]))
  : {};
const url: string = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const app = "http://localhost:3100";
const running = url.includes("127.0.0.1") && (await fetch(`${app}/`, { method: "HEAD" }).then((r) => r.ok, () => false));

async function person() {
  const c: SupabaseClient = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data } = await c.auth.signInAnonymously();
  const token = data.session!.access_token;
  const call = async (action: string, body: Record<string, unknown> = {}) => {
    const res = await fetch(`${app}/api/room`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...body }),
    });
    return { status: res.status, json: await res.json() };
  };
  return { c, id: data.user!.id, call };
}

const until = async (check: () => Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
};

describe.runIf(running)("full round", () => {
  it("runs create, join, realtime, ready, decider and reveal, and refuses bad actors", async () => {
    const [ann, ben, eve] = [await person(), await person(), await person()];

    expect((await fetch(`${app}/api/room`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await ann.call("create", { services: ["hacked"] })).status).toBe(400);
    expect((await ann.call("nonsense")).status).toBe(400);
    expect((await ann.call("constructor")).status).toBe(400);

    const { json: { code } } = await ann.call("create", { services: ["netflix", "stan"] });
    expect((await ben.call("join", { code })).status).toBe(200);
    expect((await eve.call("join", { code })).status).toBe(200);

    const { data: session } = await ann.c.from("sessions").select("id").eq("code", code).single();
    const sessionId = session!.id;
    const people = (await ann.c.from("participants").select("*").eq("session_id", sessionId)).data!;
    const [annP, , eveP] = [ann, ben, eve].map((u) => people.find((p) => p.user_id === u.id));
    expect(new Set(people.map((p) => p.name)).size).toBe(3);

    expect((await ben.call("start", { sessionId })).status).toBe(403);
    expect((await ben.call("kick", { sessionId, participantId: annP.id })).status).toBe(403);
    expect((await ann.call("kick", { sessionId, participantId: eveP.id })).status).toBe(200);
    expect((await eve.call("join", { code })).status).toBe(403);
    expect((await eve.c.from("participants").select("id").eq("session_id", sessionId)).data).toEqual([]);

    const start = await ann.call("start", { sessionId });
    expect(start.status).toBe(200);
    const films = (await ann.c.from("session_films").select("film_id, data").eq("session_id", sessionId).order("position")).data!;
    expect(films.length).toBeGreaterThanOrEqual(40);
    const families = new Map<string, number>();
    for (const f of films) families.set(f.data.family, (families.get(f.data.family) ?? 0) + 1);
    expect(Math.max(...families.values())).toBeLessThanOrEqual(2);

    const heard: number[] = [];
    const channel = ben.c.channel("t").on("postgres_changes", { event: "INSERT", schema: "public", table: "swipes", filter: `session_id=eq.${sessionId}` }, (p) => heard.push(p.new.film_id));
    await new Promise<void>((resolve) => channel.subscribe((s) => s === "SUBSCRIBED" && resolve()));
    await new Promise((r) => setTimeout(r, 500));

    for (const f of films.slice(0, 7)) await ann.c.from("swipes").insert({ participant_id: annP.id, session_id: sessionId, film_id: f.film_id, liked: true });
    expect(await until(async () => heard.length >= 7)).toBe(true);

    expect((await ben.call("ready", { sessionId, ready: true })).status).toBe(200);
    expect((await ann.call("ready", { sessionId, ready: true })).status).toBe(200);
    const rounds = async () => (await ann.c.from("rounds").select("*").eq("session_id", sessionId).order("number")).data!;
    let round = (await rounds()).at(-1)!;
    expect(round.film_ids.length).toBe(4);

    const [a, b, c] = round.film_ids;
    expect((await ann.call("mark", { sessionId, roundId: round.id, cross: 999999, tick: a })).status).toBe(400);
    expect((await ann.call("mark", { sessionId, roundId: round.id, cross: a, tick: a })).status).toBe(400);
    expect((await ann.call("mark", { sessionId, roundId: round.id, cross: c, tick: a })).status).toBe(200);
    expect((await ben.call("mark", { sessionId, roundId: round.id, cross: c, tick: b })).status).toBe(200);

    round = (await rounds()).at(-1)!;
    expect(round.number).toBe(2);
    expect(round.film_ids.sort()).toEqual([a, b].sort());
    await Promise.all([
      ann.call("mark", { sessionId, roundId: round.id, tick: a }),
      ben.call("mark", { sessionId, roundId: round.id, tick: b }),
    ]);
    expect(await until(async () => (await ann.c.from("sessions").select("status").eq("id", sessionId).single()).data!.status === "closed")).toBe(true);
    const done = (await ann.c.from("sessions").select("winner_film_id, reveal_film_ids").eq("id", sessionId).single()).data!;
    expect([a, b]).toContain(done.winner_film_id);
    expect(done.reveal_film_ids.sort()).toEqual([a, b].sort());

    expect((await ann.call("again", { sessionId })).status).toBe(200);
    const next = (await ann.c.from("sessions").select("status, game").eq("id", sessionId).single()).data!;
    expect(next.status).toBe("swiping");
    expect(next.game).toBe(1);
    const fresh = (await ann.c.from("session_films").select("film_id").eq("session_id", sessionId)).data!.map((f) => f.film_id);
    expect(fresh.some((id) => films.some((f) => f.film_id === id))).toBe(false);
    ben.c.removeChannel(channel);
  });
});
