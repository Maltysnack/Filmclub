// Tries to break the database rules as a real anonymous user. Needs `supabase start`.
import { readFileSync, existsSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const env = existsSync(".env.development.local")
  ? Object.fromEntries(readFileSync(".env.development.local", "utf8").split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]))
  : {};
const url: string = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const running = url.includes("127.0.0.1") && (await fetch(`${url}/auth/v1/health`).then((r) => r.ok, () => false));

const person = async () => {
  const c = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data } = await c.auth.signInAnonymously();
  return { c, id: data.user!.id };
};

describe.runIf(running)("database rules", () => {
  let service: SupabaseClient;
  let alice: Awaited<ReturnType<typeof person>>;
  let bob: Awaited<ReturnType<typeof person>>;
  let mallory: Awaited<ReturnType<typeof person>>;
  let sid: string;
  let aliceP: string;
  let bobP: string;

  beforeAll(async () => {
    service = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    [alice, bob, mallory] = [await person(), await person(), await person()];
    const code = "S" + Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[01IO]/g, "A");
    const { data } = await service.from("sessions").insert({ code, character_set: "Hogwarts", services: ["netflix"], status: "swiping" }).select().single();
    sid = data!.id;
    const { data: ps, error: pe } = await service.from("participants").insert([
      { session_id: sid, user_id: alice.id, name: "Dobby", is_host: true },
      { session_id: sid, user_id: bob.id, name: "Hermione", is_host: false },
    ]).select();
    if (pe) throw new Error(JSON.stringify(pe));
    aliceP = ps![0].id;
    bobP = ps![1].id;
    await service.from("session_films").insert([1, 2, 3].map((id, position) => ({ session_id: sid, film_id: id, position, data: { id } })));
  });

  it("strangers cannot read a session or its contents", async () => {
    for (const table of ["sessions", "participants", "session_films", "swipes", "rounds", "marks"]) {
      const { data } = await mallory.c.from(table).select("*").limit(5);
      expect(data ?? []).toEqual([]);
    }
  });

  it("signed-out visitors can read nothing", async () => {
    const anon = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const table of ["sessions", "participants", "swipes"]) {
      const { data } = await anon.from(table).select("id").limit(1);
      expect(data ?? []).toEqual([]);
    }
  });

  it("members read their session but never the ban list", async () => {
    const { data } = await alice.c.from("sessions").select("id, status").eq("id", sid);
    expect(data).toHaveLength(1);
    const banned = await alice.c.from("sessions").select("banned_users").eq("id", sid);
    expect(banned.error).not.toBeNull();
  });

  it("nobody can write game state directly", async () => {
    expect((await alice.c.from("sessions").insert({ code: "ZZZZ", character_set: "x", services: ["netflix"] })).error).not.toBeNull();
    await alice.c.from("sessions").update({ winner_film_id: 1, status: "closed" }).eq("id", sid);
    const { data } = await service.from("sessions").select("status").eq("id", sid).single();
    expect(data!.status).toBe("swiping");
    expect((await alice.c.from("participants").insert({ session_id: sid, user_id: alice.id, name: "x" })).error).not.toBeNull();
    await alice.c.from("participants").update({ is_host: false }).eq("id", bobP);
    await alice.c.from("participants").delete().eq("id", bobP);
    expect((await service.from("participants").select("id").eq("session_id", sid)).data).toHaveLength(2);
    expect((await alice.c.from("marks").insert({ round_id: sid, participant_id: aliceP, session_id: sid, tick_id: 1 })).error).not.toBeNull();
  });

  it("swipes are limited to yourself, your session and its films", async () => {
    expect((await mallory.c.from("swipes").insert({ participant_id: aliceP, session_id: sid, film_id: 1, liked: true })).error).not.toBeNull();
    expect((await alice.c.from("swipes").insert({ participant_id: bobP, session_id: sid, film_id: 1, liked: true })).error).not.toBeNull();
    expect((await alice.c.from("swipes").insert({ participant_id: aliceP, session_id: sid, film_id: 999, liked: true })).error).not.toBeNull();
    expect((await alice.c.from("swipes").insert({ participant_id: aliceP, session_id: sid, film_id: 1, liked: false })).error).toBeNull();
    expect((await alice.c.from("swipes").insert({ participant_id: aliceP, session_id: sid, film_id: 1, liked: true })).error).not.toBeNull();
    await alice.c.from("swipes").update({ liked: true }).eq("participant_id", aliceP);
    const { data } = await service.from("swipes").select("liked").eq("participant_id", aliceP);
    expect(data![0].liked).toBe(false);
  });

  it("simultaneous last likes still produce a winner", async () => {
    await Promise.all([
      alice.c.from("swipes").insert({ participant_id: aliceP, session_id: sid, film_id: 2, liked: true }),
      bob.c.from("swipes").insert({ participant_id: bobP, session_id: sid, film_id: 2, liked: true }),
    ]);
    const { data } = await service.from("sessions").select("status, winner_film_id").eq("id", sid).single();
    expect(data).toEqual({ status: "closed", winner_film_id: 2 });
  });

  it("no swipes after the round closes", async () => {
    expect((await alice.c.from("swipes").insert({ participant_id: aliceP, session_id: sid, film_id: 3, liked: true })).error).not.toBeNull();
  });
});
