import { admin } from "@/lib/admin";
import { nextName, randomSet } from "@/lib/characters";
import { resolveRound, roundSeconds, shortlist } from "@/lib/decider";
import { allowed, clientIp } from "@/lib/ratelimit";
import { SERVICES } from "@/lib/services";
import { buildPool } from "@/lib/tmdb";
import type { Film, Mark, Participant, Round, Swipe } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 2_000;
const MAX_PEOPLE = 12;
const MIN_POOL = 40;
const MAX_SESSIONS_PER_HOUR = 300;
const SWIPE_SECONDS = 120;
const BOT_SWIPE_LIMIT = 14;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

class Refused extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

interface SessionRow {
  id: string;
  code: string;
  status: string;
  character_set: string;
  services: string[];
  game: number;
  swipe_deadline: string | null;
  seen_film_ids: number[];
  banned_users: string[];
}

const db = () => admin();
const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString();

function must<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

async function peopleIn(sessionId: string): Promise<Participant[]> {
  return must(await db().from("participants").select("*").eq("session_id", sessionId).order("joined_at"));
}

async function poolOf(sessionId: string): Promise<Film[]> {
  const rows = must(await db().from("session_films").select("data").eq("session_id", sessionId).order("position"));
  return (rows as { data: Film }[]).map((r) => r.data);
}

async function swipesOf(sessionId: string): Promise<Swipe[]> {
  return must(await db().from("swipes").select("participant_id, film_id, liked").eq("session_id", sessionId));
}

async function currentRound(sessionId: string): Promise<Round | null> {
  const rows = must(await db().from("rounds").select("*").eq("session_id", sessionId).order("number", { ascending: false }).limit(1));
  return (rows as Round[])[0] ?? null;
}

async function loadSession(id: unknown): Promise<SessionRow> {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) throw new Refused("Unknown session.", 404);
  const row = must(await db().from("sessions").select("*").eq("id", id).maybeSingle());
  if (!row) throw new Refused("Unknown session.", 404);
  return row as SessionRow;
}

async function member(sessionId: string, userId: string): Promise<{ me: Participant; people: Participant[] }> {
  const people = await peopleIn(sessionId);
  const me = people.find((p) => p.user_id === userId);
  if (!me) throw new Refused("You are not in this session.", 403);
  return { me, people };
}

function requireHost(me: Participant) {
  if (!me.is_host) throw new Refused("Only the host can do that.", 403);
}

async function freshPool(session: SessionRow, people: number, game: number): Promise<Film[]> {
  let pool = await buildPool(session.services, people, session.seen_film_ids, game);
  if (pool.length < MIN_POOL) pool = await buildPool(session.services, people, [], 0); // the group has seen everything
  if (pool.length < MIN_POOL) throw new Refused("Not enough films on those services. Try adding one.");
  return pool;
}

async function deal(session: SessionRow, pool: Film[], game: number) {
  const rows = pool.map((film, position) => ({ session_id: session.id, film_id: film.id, position, data: film }));
  must(await db().from("session_films").insert(rows));
  must(await db().from("sessions").update({
    status: "swiping",
    game,
    swipe_deadline: inSeconds(SWIPE_SECONDS),
    winner_film_id: null,
    reveal_film_ids: [],
    seen_film_ids: session.seen_film_ids,
  }).eq("id", session.id));
}

async function finish(sessionId: string, winner: number, reveal: number[]) {
  must(await db().from("sessions").update({ status: "closed", winner_film_id: winner, reveal_film_ids: reveal }).eq("id", sessionId));
}

async function openRound(sessionId: string, number: number, films: number[]) {
  must(await db().from("rounds").insert({
    session_id: sessionId,
    number,
    film_ids: films,
    deadline: inSeconds(roundSeconds(films.length)),
  }));
}

// Idempotent: any client may call this at any time, and only one caller gets each transition.
async function advance(session: SessionRow, people: Participant[]) {
  if (session.status === "swiping") {
    const timeUp = session.swipe_deadline != null && Date.now() >= Date.parse(session.swipe_deadline) - 500;
    if (!timeUp && !people.every((p) => p.ready)) return;
    const taken = must(await db().from("sessions").update({ status: "deciding" })
      .eq("id", session.id).eq("status", "swiping").select("id"));
    if ((taken as unknown[]).length === 0) return;
    const films = shortlist(await poolOf(session.id), await swipesOf(session.id), people.length);
    if (films.length === 1) return finish(session.id, films[0], films);
    return openRound(session.id, 1, films);
  }

  if (session.status !== "deciding") return;
  const round = await currentRound(session.id);
  if (!round || round.resolved) return;
  const marks: Mark[] = must(await db().from("marks").select("*").eq("round_id", round.id));
  const allIn = people.every((p) => marks.some((m) => m.participant_id === p.id));
  if (!allIn && Date.now() < Date.parse(round.deadline) - 500) return;

  const taken = must(await db().from("rounds").update({ resolved: true }).eq("id", round.id).eq("resolved", false).select("id"));
  if ((taken as unknown[]).length === 0) return;
  const outcome = resolveRound(round.film_ids, marks);
  if ("next" in outcome) return openRound(session.id, round.number + 1, outcome.next);
  if ("winner" in outcome) return finish(session.id, outcome.winner, [outcome.winner]);
  const pick = outcome.tied[Math.floor(Math.random() * outcome.tied.length)];
  return finish(session.id, pick, outcome.tied);
}

async function botsAct(session: SessionRow, people: Participant[]) {
  const bots = people.filter((p) => p.is_bot);
  if (session.status === "swiping") {
    const [pool, swipes] = [await poolOf(session.id), await swipesOf(session.id)];
    const likedByAnyone = new Set(swipes.filter((s) => s.liked).map((s) => s.film_id));
    for (const bot of bots) {
      const mine = new Set(swipes.filter((s) => s.participant_id === bot.id).map((s) => s.film_id));
      if (mine.size >= BOT_SWIPE_LIMIT) {
        if (!bot.ready) must(await db().from("participants").update({ ready: true }).eq("id", bot.id));
        continue;
      }
      const options = pool.filter((f) => !mine.has(f.id));
      const friendly = options.filter((f) => likedByAnyone.has(f.id));
      const list = friendly.length && Math.random() < 0.5 ? friendly : options;
      const film = list[Math.floor(Math.random() * list.length)];
      if (!film) continue;
      const likes = swipes.filter((s) => s.film_id === film.id && s.liked).length;
      // Rarely completes a unanimous match, so someone testing alone gets to see the decider.
      const wouldWin = likes >= people.length - 1;
      const liked = Math.random() < (wouldWin ? 0.1 : likedByAnyone.has(film.id) ? 0.6 : 0.35);
      await db().from("swipes").upsert(
        { participant_id: bot.id, session_id: session.id, film_id: film.id, liked },
        { onConflict: "participant_id,film_id", ignoreDuplicates: true },
      );
    }
    return;
  }
  if (session.status !== "deciding") return;
  const round = await currentRound(session.id);
  if (!round || round.resolved) return;
  const marks: Mark[] = must(await db().from("marks").select("*").eq("round_id", round.id));
  for (const bot of bots) {
    if (marks.some((m) => m.participant_id === bot.id)) continue;
    const films = [...round.film_ids].sort(() => Math.random() - 0.5);
    must(await db().from("marks").insert({
      round_id: round.id,
      participant_id: bot.id,
      session_id: session.id,
      cross_id: films.length === 2 ? null : films[1],
      tick_id: films[0],
    }));
  }
}

const handlers: Record<string, (user: string, body: Record<string, unknown>, ip: string) => Promise<unknown>> = {
  async create(user, body, ip) {
    if (!(await allowed("create", ip)) || !(await allowed("create", user))) throw new Refused("Too many sessions. Try later.", 429);
    const services = Array.isArray(body.services) ? [...new Set(body.services)] : [];
    if (services.length === 0 || !services.every((s) => SERVICES.some((known) => known.id === s))) throw new Refused("Pick a service.");

    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { count } = await db().from("sessions").select("id", { count: "exact", head: true }).gt("created_at", hourAgo);
    if ((count ?? 0) >= MAX_SESSIONS_PER_HOUR) throw new Refused("Filmclub is very busy. Try later.", 503);

    const set = randomSet();
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
      const { data, error } = await db().from("sessions").insert({ code, character_set: set, services }).select("id").single();
      if (error) continue;
      must(await db().from("participants").insert({ session_id: data.id, user_id: user, name: nextName(set, []), is_host: true }));
      return { code };
    }
    throw new Error("No free code");
  },

  async join(user, body, ip) {
    if (!(await allowed("join", ip))) throw new Refused("Too many tries. Wait a moment.", 429);
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    if (!/^[A-Z2-9]{4}$/.test(code)) throw new Refused("That code doesn't look right.");
    const session = must(await db().from("sessions").select("*").eq("code", code).maybeSingle()) as SessionRow | null;
    if (!session) throw new Refused("No session with that code.", 404);
    if (session.banned_users.includes(user)) throw new Refused("You were removed from this session.", 403);
    const people = await peopleIn(session.id);
    if (people.some((p) => p.user_id === user)) return { code };
    if (session.status === "deciding" || session.status === "closed") throw new Refused("This round is already deciding.", 409);
    if (people.length >= MAX_PEOPLE) throw new Refused("This session is full.", 409);
    const taken = people.map((p) => p.name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const { error } = await db().from("participants").insert({ session_id: session.id, user_id: user, name: nextName(session.character_set, taken) });
      if (!error) return { code };
      taken.push(...(await peopleIn(session.id)).map((p) => p.name));
    }
    throw new Error("Could not join");
  },

  async addBots(user, body) {
    const session = await loadSession(body.sessionId);
    const { me, people } = await member(session.id, user);
    requireHost(me);
    if (session.status !== "lobby" || people.length !== 1) throw new Refused("Bots only join a solo lobby.", 409);
    const taken = [me.name];
    const rows = Array.from({ length: 3 }, () => {
      const name = nextName(session.character_set, taken);
      taken.push(name);
      return { session_id: session.id, name, is_bot: true };
    });
    must(await db().from("participants").insert(rows));
    return {};
  },

  async start(user, body) {
    const session = await loadSession(body.sessionId);
    const { me, people } = await member(session.id, user);
    requireHost(me);
    if (session.status !== "lobby") return {};
    if (people.length < 2) throw new Refused("You need at least one more person.", 409);
    await deal(session, await freshPool(session, people.length, session.game), session.game);
    return {};
  },

  async ready(user, body) {
    const session = await loadSession(body.sessionId);
    const { me, people } = await member(session.id, user);
    const ready = body.ready === true;
    must(await db().from("participants").update({ ready }).eq("id", me.id));
    await advance(session, people.map((p) => (p.id === me.id ? { ...p, ready } : p)));
    return {};
  },

  async mark(user, body) {
    const session = await loadSession(body.sessionId);
    const { me, people } = await member(session.id, user);
    if (session.status !== "deciding") throw new Refused("Voting has finished.", 409);
    const round = await currentRound(session.id);
    if (!round || round.resolved || round.id !== body.roundId) throw new Refused("That round has finished.", 409);
    const tick = body.tick;
    const cross = round.film_ids.length === 2 ? null : body.cross;
    const valid = (id: unknown) => typeof id === "number" && round.film_ids.includes(id);
    if (!valid(tick) || (cross !== null && !valid(cross)) || cross === tick) throw new Refused("Pick one to cross and one to tick.");
    const { error } = await db().from("marks").insert({ round_id: round.id, participant_id: me.id, session_id: session.id, cross_id: cross, tick_id: tick });
    if (error && error.code !== "23505") throw new Error(error.message);
    await advance(session, people);
    return {};
  },

  async advance(user, body) {
    const session = await loadSession(body.sessionId);
    const { people } = await member(session.id, user);
    await advance(session, people);
    return {};
  },

  async bots(user, body) {
    const session = await loadSession(body.sessionId);
    const { me, people } = await member(session.id, user);
    requireHost(me);
    await botsAct(session, people);
    await advance(session, await peopleIn(session.id));
    return {};
  },

  async kick(user, body) {
    const session = await loadSession(body.sessionId);
    const { me, people } = await member(session.id, user);
    requireHost(me);
    const target = people.find((p) => p.id === body.participantId);
    if (!target || target.id === me.id) throw new Refused("Pick someone else.");
    must(await db().from("participants").delete().eq("id", target.id));
    if (target.user_id) {
      must(await db().from("sessions").update({ banned_users: [...session.banned_users, target.user_id] }).eq("id", session.id));
    }
    await advance(session, people.filter((p) => p.id !== target.id));
    return {};
  },

  async claimHost(user, body) {
    const session = await loadSession(body.sessionId);
    const { me, people } = await member(session.id, user);
    if (me.is_host || me.id !== people.find((p) => !p.is_bot && p.id !== people.find((h) => h.is_host)?.id)?.id) return {};
    must(await db().from("participants").update({ is_host: false }).eq("session_id", session.id).eq("is_host", true));
    must(await db().from("participants").update({ is_host: true }).eq("id", me.id));
    return {};
  },

  async again(user, body) {
    const session = await loadSession(body.sessionId);
    const { me, people } = await member(session.id, user);
    requireHost(me);
    if (session.status !== "closed") return {};
    const old = await poolOf(session.id);
    session.seen_film_ids = [...session.seen_film_ids, ...old.map((f) => f.id)].slice(-1500);
    // Built first: if this fails, the finished game stays on screen.
    const pool = await freshPool(session, people.length, session.game + 1);
    must(await db().from("session_films").delete().eq("session_id", session.id));
    must(await db().from("rounds").delete().eq("session_id", session.id));
    must(await db().from("participants").update({ ready: false }).eq("session_id", session.id));
    await deal(session, pool, session.game + 1);
    return {};
  },
};

async function userFrom(req: Request): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return null;
  const { data } = await db().auth.getUser(token);
  return data.user?.id ?? null;
}

export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw new Refused("Too large.", 413);
    const user = await userFrom(req);
    if (!user) throw new Refused("Please reload.", 401);
    if (!(await allowed("action", user))) throw new Refused("Slow down a little.", 429);
    const body = (await req.json()) as Record<string, unknown>;
    const handler = typeof body.action === "string" && Object.hasOwn(handlers, body.action) ? handlers[body.action] : null;
    if (!handler) throw new Refused("Unknown action.");
    return Response.json(await handler(user, body, clientIp(req)));
  } catch (error) {
    if (error instanceof Refused) return Response.json({ error: error.message }, { status: error.status });
    console.error("room action failed", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}

