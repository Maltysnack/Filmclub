import { after } from "next/server";
import { admin } from "@/lib/admin";
import { nextName, randomSet } from "@/lib/characters";
import { DECK_RULES } from "@/lib/deck";
import { resolveRound, roundSeconds, shortlist } from "@/lib/decider";
import { record, withEvents } from "@/lib/events";
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
const ROUND_GRACE_MS = 2_500; // late votes still count, so a slow connection doesn't lose one
const BOT_SWIPE_LIMIT = 40;
const BOT_DAWDLE = 0.3; // chance per tick, so people see themselves waiting on the bots
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const UUID = /^[0-9a-f-]{36}$/;
// Polled every few seconds, so only slow or failed calls go in the timeline.
const QUIET_ACTIONS = new Set(["bots", "advance", "report"]);
const REPORTS = new Set(["swipe_failed", "ready_failed", "mark_failed", "slow"]);

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
const about = (session: SessionRow) => ({ session_id: session.id, code: session.code, game: session.game });

function must<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

// Everyone who has ever joined, so a returning person keeps their character.
async function everyone(sessionId: string): Promise<Participant[]> {
  return must(await db().from("participants").select("*").eq("session_id", sessionId).order("joined_at"));
}

async function peopleIn(sessionId: string): Promise<Participant[]> {
  return (await everyone(sessionId)).filter((p) => !p.left_session);
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
  if (typeof id !== "string" || !UUID.test(id)) throw new Refused("Unknown session.", 404);
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

// Big enough that everyone opens on films nobody else is seeing.
async function freshPool(session: SessionRow, people: number, game: number): Promise<Film[]> {
  const needed = Math.max(MIN_POOL, DECK_RULES.sliceSize * people);
  let pool = await buildPool(session.services, people, session.seen_film_ids, game);
  if (pool.length < needed) pool = await buildPool(session.services, people, [], 0); // the group has seen everything
  if (pool.length < MIN_POOL) throw new Refused("Not enough films on those services. Try adding one.");
  return pool;
}

async function deal(session: SessionRow, pool: Film[]) {
  const rows = pool.map((film, position) => ({ session_id: session.id, film_id: film.id, position, data: film }));
  must(await db().from("session_films").insert(rows));
  must(await db().from("sessions").update({
    status: "swiping",
    swipe_deadline: inSeconds(SWIPE_SECONDS),
    winner_film_id: null,
    reveal_film_ids: [],
  }).eq("id", session.id));
  record({ kind: "swiping", ...about(session), detail: { films: pool.length } });
}

async function finish(session: SessionRow, winner: number | null, reveal: number[], why: string) {
  must(await db().from("sessions").update({ status: "closed", winner_film_id: winner, reveal_film_ids: reveal }).eq("id", session.id));
  record({ kind: "finished", ...about(session), detail: { why, winner, reveal } });
}

async function openRound(session: SessionRow, number: number, films: number[]) {
  const seconds = roundSeconds(films.length);
  must(await db().from("rounds").insert({ session_id: session.id, number, film_ids: films, deadline: inSeconds(seconds) }));
  record({ kind: "round_open", ...about(session), detail: { number, films: films.length, seconds } });
}

// No likes ends the round with no winner (someone is away, or something broke). One like
// wins outright. Safe to call twice: the unique (session, number) key lets only one first round exist.
async function openFirstRound(session: SessionRow, people: Participant[]) {
  const [swipes, pool] = await Promise.all([swipesOf(session.id), poolOf(session.id)]);
  record({
    kind: "deciding",
    ...about(session),
    detail: {
      people: people.map((p) => {
        const mine = swipes.filter((s) => s.participant_id === p.id);
        return { name: p.name, bot: p.is_bot, swipes: mine.length, likes: mine.filter((s) => s.liked).length, ready: p.ready };
      }),
    },
  });
  if (!swipes.some((s) => s.liked)) return finish(session, null, [], "no likes");
  const films = shortlist(pool, swipes, people.length);
  if (films.length === 1) return finish(session, films[0], films, "one like");
  try {
    await openRound(session, 1, films);
  } catch (e) {
    if (!/duplicate key/i.test((e as Error).message)) throw e;
  }
}

// Idempotent: any client may call this at any time, and only one caller gets each transition.
async function advance(session: SessionRow, people: Participant[]) {
  if (session.status === "swiping") {
    const timeUp = session.swipe_deadline != null && Date.now() >= Date.parse(session.swipe_deadline) - 500;
    if (!timeUp && !people.every((p) => p.ready)) return;
    const taken = must(await db().from("sessions").update({ status: "deciding" })
      .eq("id", session.id).eq("status", "swiping").select("id"));
    if ((taken as unknown[]).length === 0) return;
    return openFirstRound(session, people);
  }

  if (session.status !== "deciding") return;
  const round = await currentRound(session.id);
  // A crash after the flip to deciding leaves no round; any later call finishes the job.
  if (!round) return openFirstRound(session, people);
  if (round.resolved) return;
  const marks: Mark[] = must(await db().from("marks").select("*").eq("round_id", round.id));
  const allIn = people.every((p) => marks.some((m) => m.participant_id === p.id));
  if (!allIn && Date.now() < Date.parse(round.deadline) + ROUND_GRACE_MS) return;

  // Not one vote arrived, which usually means they were lost on the way. One more go.
  if (marks.length === 0 && !round.extended) {
    const extended = must(await db().from("rounds").update({ deadline: inSeconds(roundSeconds(round.film_ids.length)), extended: true })
      .eq("id", round.id).eq("resolved", false).eq("extended", false).select("id"));
    if ((extended as unknown[]).length) record({ kind: "round_extended", ...about(session), detail: { number: round.number } });
    return;
  }

  const taken = must(await db().from("rounds").update({ resolved: true }).eq("id", round.id).eq("resolved", false).select("id"));
  if ((taken as unknown[]).length === 0) return;
  const outcome = resolveRound(round.film_ids, marks);
  record({ kind: "round_resolved", ...about(session), detail: { number: round.number, votes: marks.length, people: people.length, outcome } });
  if ("next" in outcome) return openRound(session, round.number + 1, outcome.next);
  if ("winner" in outcome) return finish(session, outcome.winner, [outcome.winner], "vote");
  const pick = outcome.tied[Math.floor(Math.random() * outcome.tied.length)];
  return finish(session, pick, outcome.tied, "tie");
}

async function botsAct(session: SessionRow, people: Participant[]) {
  const bots = people.filter((p) => p.is_bot);
  if (session.status === "swiping") {
    const [pool, swipes] = [await poolOf(session.id), await swipesOf(session.id)];
    const likedByAnyone = new Set(swipes.filter((s) => s.liked).map((s) => s.film_id));
    for (const bot of bots) {
      const mine = new Set(swipes.filter((s) => s.participant_id === bot.id).map((s) => s.film_id));
      const humansReady = people.every((p) => p.is_bot || p.ready);
      if (humansReady && !bot.ready && Math.random() < BOT_DAWDLE) {
        must(await db().from("participants").update({ ready: true }).eq("id", bot.id));
      }
      if (mine.size >= BOT_SWIPE_LIMIT) continue;
      const options = pool.filter((f) => !mine.has(f.id));
      const friendly = options.filter((f) => likedByAnyone.has(f.id));
      const list = friendly.length && Math.random() < 0.5 ? friendly : options;
      const film = list[Math.floor(Math.random() * list.length)];
      if (!film) continue;
      const liked = Math.random() < (likedByAnyone.has(film.id) ? 0.6 : 0.35);
      await db().from("swipes").upsert(
        { participant_id: bot.id, session_id: session.id, film_id: film.id, liked },
        { onConflict: "participant_id,film_id", ignoreDuplicates: true },
      );
    }
    return;
  }
  if (session.status !== "deciding") return;
  const round = await currentRound(session.id);
  // A crash after the flip to deciding leaves no round; any later call finishes the job.
  if (!round) return openFirstRound(session, people);
  if (round.resolved) return;
  const marks: Mark[] = must(await db().from("marks").select("*").eq("round_id", round.id));
  for (const bot of bots) {
    if (marks.some((m) => m.participant_id === bot.id) || Math.random() > BOT_DAWDLE) continue;
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

// Keeps a client report small and plain before it goes in the timeline.
function cleanDetail(detail: unknown): Record<string, unknown> {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return {};
  const text = JSON.stringify(detail);
  return text.length > 600 ? { truncated: text.slice(0, 600) } : (detail as Record<string, unknown>);
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
      record({ kind: "created", session_id: data.id, code, game: 0, user_id: user, detail: { services } });
      // Warms the film cache while people gather in the lobby, so Start is quicker.
      after(() => buildPool(services as string[], 4, [], 0).then(() => {}, () => {}));
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
    const all = await everyone(session.id);
    const known = all.find((p) => p.user_id === user);
    if (known) {
      if (known.left_session) {
        const hosted = all.some((p) => p.is_host && !p.left_session);
        must(await db().from("participants").update({ left_session: false, is_host: !hosted }).eq("id", known.id));
        record({ kind: "rejoined", ...about(session), user_id: user });
      }
      return { code };
    }
    if (session.status === "deciding" || session.status === "closed") throw new Refused("This round is already deciding.", 409);
    if (all.filter((p) => !p.left_session).length >= MAX_PEOPLE) throw new Refused("This session is full.", 409);
    const taken = all.map((p) => p.name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const { error } = await db().from("participants").insert({ session_id: session.id, user_id: user, name: nextName(session.character_set, taken) });
      if (!error) {
        record({ kind: "joined", ...about(session), user_id: user });
        return { code };
      }
      taken.push(...(await everyone(session.id)).map((p) => p.name));
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
    await deal(session, await freshPool(session, people.length, session.game));
    return {};
  },

  async ready(user, body) {
    const session = await loadSession(body.sessionId);
    const { me, people } = await member(session.id, user);
    const ready = body.ready === true;
    if (ready) {
      const { count } = await db().from("swipes").select("film_id", { count: "exact", head: true }).eq("participant_id", me.id).eq("liked", true);
      if (!count) throw new Refused("Like at least one film first.", 409);
    }
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

  async leave(user, body) {
    const session = await loadSession(body.sessionId);
    const { me, people } = await member(session.id, user);
    must(await db().from("participants").update({ left_session: true, ready: false, rematch: false, is_host: false }).eq("id", me.id));
    record({ kind: "left", ...about(session), user_id: user });
    const remaining = people.filter((p) => p.id !== me.id);
    const next = remaining.find((p) => !p.is_bot);
    if (!next) return {};
    if (me.is_host) must(await db().from("participants").update({ is_host: true }).eq("id", next.id));
    await advance(session, remaining);
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

  // Play Again needs more than half of the humans, so one person can't pull everyone off the winner.
  async rematch(user, body) {
    const session = await loadSession(body.sessionId);
    const { me, people } = await member(session.id, user);
    if (session.status !== "closed") return {};
    must(await db().from("participants").update({ rematch: body.rematch === true }).eq("id", me.id));
    const humans = people.filter((p) => !p.is_bot);
    const keen = humans.filter((p) => (p.id === me.id ? body.rematch === true : p.rematch)).length;
    if (keen * 2 <= humans.length) return {};

    const old = await poolOf(session.id);
    const seen = [...session.seen_film_ids, ...old.map((f) => f.id)].slice(-1500);
    // Built first: if this fails, the finished game stays on screen.
    const pool = await freshPool({ ...session, seen_film_ids: seen }, people.length, session.game + 1);
    // One transaction, so no phone can see the new game number with the old films.
    // Two people can get here together; the swap only lets one through.
    const swapped = must(await db().rpc("swap_game", {
      p_session: session.id,
      p_game: session.game,
      p_films: pool.map((film, position) => ({ film_id: film.id, position, data: film })),
      p_seen: seen,
      p_seconds: SWIPE_SECONDS,
    }));
    if (swapped) record({ kind: "play_again", ...about(session), game: session.game + 1, detail: { films: pool.length } });
    return {};
  },

  // A phone telling the timeline about something that went wrong on its side.
  async report(user, body) {
    const session = await loadSession(body.sessionId);
    await member(session.id, user);
    const kind = typeof body.kind === "string" && REPORTS.has(body.kind) ? body.kind : null;
    if (!kind) throw new Refused("Unknown report.");
    const ms = typeof body.ms === "number" && Number.isFinite(body.ms) ? Math.round(body.ms) : null;
    record({ kind: `client:${kind}`, ...about(session), user_id: user, ms, ok: kind === "slow", detail: cleanDetail(body.detail) });
    return {};
  },
};

// Checked on our own server against the project's public signing key, so it needs no
// network call and keeps working when Supabase is slow. A token that can't be checked
// right now is not the same as a bad one, so it must never look like a logout.
async function userFrom(req: Request): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return null;
  const { data, error } = await db().auth.getClaims(token).catch((e: Error) => ({ data: null, error: e }));
  const sub = data?.claims?.sub;
  if (typeof sub === "string" && UUID.test(sub)) return sub;
  // Only failing to fetch the signing key is our problem. Bad, forged and expired tokens are the caller's.
  const unreachable = error && (/RetryableFetch|TypeError|AbortError|TimeoutError/.test(error.name) || /fetch|network|timed? ?out|abort/i.test(error.message));
  if (unreachable) throw new Refused("Connection trouble. Try again.", 503);
  return null;
}

export async function POST(req: Request) {
  return withEvents(async () => {
    const started = Date.now();
    let action = "unknown";
    let user: string | null = null;
    let sessionId: string | null = null;
    let status = 200;
    let failure: string | undefined;
    try {
      if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) throw new Refused("Too large.", 413);
      user = await userFrom(req);
      if (!user) throw new Refused("Please reload.", 401);
      if (!(await allowed("action", user))) throw new Refused("Slow down a little.", 429);
      const body = (await req.json()) as Record<string, unknown>;
      if (typeof body.action === "string") action = body.action.slice(0, 40);
      if (typeof body.sessionId === "string" && UUID.test(body.sessionId)) sessionId = body.sessionId;
      const handler = Object.hasOwn(handlers, action) ? handlers[action] : null;
      if (!handler) throw new Refused("Unknown action.");
      return Response.json(await handler(user, body, clientIp(req)));
    } catch (error) {
      if (error instanceof Refused) {
        status = error.status;
        failure = error.message;
        return Response.json({ error: error.message }, { status: error.status });
      }
      status = 500;
      failure = (error as Error).message;
      console.error("room action failed", error);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    } finally {
      const ms = Date.now() - started;
      if (!(QUIET_ACTIONS.has(action) && status === 200 && ms < 1000)) {
        record({ kind: `action:${action}`, session_id: sessionId, user_id: user, ms, ok: status < 500, detail: { status, error: failure } });
      }
    }
  });
}
