import { supabase } from "./supabase";
import { Session, Participant, Film, Match, WatchMode, Region } from "@/types";
import { getFilmDetail, tmdbToFilm } from "./tmdb";
import { fetchWatchProviders, getService } from "./streaming";

// ── Session code generation ───────────────────────────────────────────────────

const WORDS = [
  "WOLF", "BEAR", "HAWK", "NOVA", "DUSK", "REEL", "LENS", "NOIR",
  "GOLD", "STAR", "FILM", "EPIC", "CAGE", "CULT", "WILD", "IRON",
  "JADE", "MOON", "REEF", "SAGE",
  "DAWN", "DAZE", "ECHO", "EDGE", "FADE", "FAWN", "FIRE", "FIST",
  "FLOW", "GAZE", "GEAR", "GILD", "GLOW", "GRIT", "GULF", "HALO",
  "HAZE", "HEAT", "HIVE", "HOOK", "HORN", "HUNT", "ICON", "IDOL",
  "IRIS", "KEEN", "KNOT", "LACE", "LARK", "LAVA", "LEAF", "LILT",
  "LIME", "LINK", "LION", "LOFT", "LOOM", "LORE", "LYNX", "MANE",
  "MARK", "MAST", "MELD", "MELT", "MESA", "MINT", "MIST", "MUSE",
  "MYTH", "NEON", "NEST", "NOOK", "OPAL", "OPUS", "ORCA", "PAVE",
  "PAWN", "PEAK", "PINE", "PYRE", "RUNE", "RUSH", "RUST", "SALT",
  "SAND", "SEAL", "SHOT", "SILK", "SILT", "SLAB", "SOOT", "SOUL",
  "SPIN", "SPUR", "SWAN", "TAKE", "TEAL", "TIDE", "TILE", "TUSK",
];

export function generateCode(): string {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  return `${word}-${num}`;
}

// ── Local storage ─────────────────────────────────────────────────────────────

export function getParticipantId(sessionCode: string): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(`filmclub_participant_${sessionCode}`);
}

export function setParticipantId(sessionCode: string, participantId: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(`filmclub_participant_${sessionCode}`, participantId);
}

export function setIsHost(sessionCode: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(`filmclub_host_${sessionCode}`, "true");
}

export function getIsHost(sessionCode: string): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(`filmclub_host_${sessionCode}`) === "true";
}

// ── Session CRUD ──────────────────────────────────────────────────────────────

export async function createSession(
  mode: "planned" | "live",
  threshold: number,
  watchMode: WatchMode = "home",
  streamingServices: string[] = [],
  region: Region = "AU",
): Promise<Session | null> {
  let code = generateCode();
  const { data: existing } = await supabase.from("sessions").select("id").eq("code", code).single();
  if (existing) code = generateCode();

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      code, mode, threshold,
      watch_mode: watchMode,
      streaming_services: streamingServices,
      region,
    })
    .select()
    .single();

  if (error) { console.error(error); return null; }
  return data;
}

export async function getSession(code: string): Promise<Session | null> {
  // Codes are stored as WORD-NN. Accept input with or without the hyphen.
  const stripped = code.trim().toUpperCase().replace(/-/g, "");
  const normalized = stripped.length >= 6
    ? stripped.slice(0, stripped.length - 2) + "-" + stripped.slice(-2)
    : stripped;
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("code", normalized)
    .single();
  if (error) return null;
  return data;
}

export async function closeSession(sessionId: string) {
  await supabase.from("sessions").update({ status: "closed" }).eq("id", sessionId);
}

/** Host only. Voids all shortlist submissions and swipes then removes the participant. */
export async function removeParticipant(sessionId: string, participantId: string): Promise<void> {
  // Clear all referencing rows first — including nulling added_by on session_films,
  // which may have a FK constraint that would otherwise block the participant delete.
  await Promise.all([
    supabase.from("shortlist_vetoes")
      .delete().eq("session_id", sessionId).eq("participant_id", participantId),
    supabase.from("shortlist_votes")
      .delete().eq("session_id", sessionId).eq("participant_id", participantId),
    supabase.from("swipes")
      .delete().eq("session_id", sessionId).eq("participant_id", participantId),
    supabase.from("session_films")
      .update({ added_by: null }).eq("session_id", sessionId).eq("added_by", participantId),
  ]);
  const { data, error } = await supabase
    .from("participants").delete().eq("id", participantId).eq("session_id", sessionId).select();
  console.log("[removeParticipant] sessionId:", sessionId, "participantId:", participantId, "deleted:", data, "error:", error?.message);
}

export async function startSession(sessionId: string) {
  await supabase.from("sessions").update({ started: true }).eq("id", sessionId);
}

export async function startTiebreaker(sessionId: string, filmIds: string[]) {
  // Reopen session, mark started, store the tiebreaker film IDs, clear old matches
  await Promise.all([
    supabase.from("sessions").update({
      status: "active",
      started: true,
      tiebreaker_film_ids: filmIds,
    }).eq("id", sessionId),
    supabase.from("matches").delete().eq("session_id", sessionId),
    supabase.from("swipes").delete()
      .eq("session_id", sessionId)
      .in("film_id", filmIds),
  ]);
}

// ── Participants ──────────────────────────────────────────────────────────────

export async function joinSession(sessionId: string, name: string): Promise<Participant | null> {
  const { data, error } = await supabase
    .from("participants")
    .insert({ session_id: sessionId, name })
    .select()
    .single();
  if (error) { console.error(error); return null; }
  return data;
}

export async function getParticipants(sessionId: string): Promise<Participant[]> {
  const { data } = await supabase
    .from("participants")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at");
  return data ?? [];
}

// ── Film pool ─────────────────────────────────────────────────────────────────

export async function upsertFilm(tmdbId: number, region: Region = "AU"): Promise<Film | null> {
  // Check cache first
  const { data: cached } = await supabase
    .from("films")
    .select("*")
    .eq("tmdb_id", tmdbId)
    .single();

  if (cached) {
    const providers: { serviceId: string; name: string; logoPath?: string | null; tmdbProviderId?: number | null }[] =
      cached.watch_providers_au ?? [];
    // Refresh if:
    //  (a) no providers stored yet — film cached before provider tracking
    //  (b) providers exist but lack logoPath — cached before logo capture
    //  (c) a stored entry's tmdbProviderId doesn't match the current AU_SERVICES
    //      mapping — catches stale data after provider ID corrections
    const hasWrongIds = providers.some((p) => {
      if (!p.tmdbProviderId) return false;
      const svc = getService(p.serviceId);
      return svc != null && svc.tmdbId !== p.tmdbProviderId;
    });
    const needsRefresh =
      providers.length === 0 ||
      providers.every((p) => p.logoPath == null) ||
      hasWrongIds ||
      !cached.imdb_id || // backfill imdb_id for films cached before this field existed
      cached.collection_id == null; // backfill collection_id so franchise blocking works
    if (needsRefresh) {
      const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY ?? "";
      // Fetch detail when imdb_id or collection info is missing.
      // OMDb rating is NOT fetched here — that's handled by the daily
      // /api/cron/backfill-ratings cron so seeding stays fast (#69).
      // allSettled so a transient TMDB blip on one fetch doesn't drop the other.
      const needsDetail = !cached.imdb_id || cached.collection_id == null;
      const settled = await Promise.allSettled([
        fetchWatchProviders(tmdbId, apiKey, region),
        needsDetail ? getFilmDetail(tmdbId) : Promise.resolve(null),
      ]);
      const fresh = settled[0].status === "fulfilled" ? settled[0].value : [];
      const detail = settled[1].status === "fulfilled" ? settled[1].value : null;
      const imdbId = detail?.imdb_id ?? cached.imdb_id ?? null;
      // Only overwrite providers if we got a non-empty result — guards against
      // transient API failures (e.g. poor connectivity overseas) clobbering
      // previously good data stored for another session's participants.
      const providerUpdate = fresh.length > 0 || providers.length === 0 ? fresh : providers;
      const updates: Record<string, unknown> = { watch_providers_au: providerUpdate };
      if (imdbId) updates.imdb_id = imdbId;
      if (detail) {
        // Use 0 as the "checked, no collection" sentinel so future encounters
        // don't re-trigger refresh. Matches the pattern used by the swipe
        // handler's async backfill in app/session/[code]/page.tsx.
        updates.collection_id = detail.belongs_to_collection?.id ?? 0;
        updates.collection_name = detail.belongs_to_collection?.name ?? null;
      }
      await supabase.from("films").update(updates).eq("id", cached.id);
      return {
        ...cached,
        watch_providers_au: providerUpdate,
        imdb_id: imdbId,
        collection_id: detail ? (detail.belongs_to_collection?.id ?? 0) : cached.collection_id,
        collection_name: detail ? (detail.belongs_to_collection?.name ?? null) : cached.collection_name,
      };
    }
    // OMDb rating backfill removed from the hot path (#69). The daily cron
    // /api/cron/backfill-ratings handles films with imdb_id but no rating.
    return cached;
  }

  // Fetch from TMDB and cache. allSettled so a TMDB providers blip doesn't
  // block the film insert — partial data (no providers) is better than no row.
  const detail = await getFilmDetail(tmdbId);
  if (!detail) return null;

  const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY ?? "";
  const filmData = tmdbToFilm(detail);
  const providersResult = await Promise.allSettled([fetchWatchProviders(tmdbId, apiKey, region)]);
  const watchProviders = providersResult[0].status === "fulfilled" ? providersResult[0].value : [];

  const { data, error } = await supabase
    .from("films")
    .upsert(
      // imdb_rating intentionally omitted — backfilled by the daily cron (#69).
      { ...filmData, watch_providers_au: watchProviders },
      { onConflict: "tmdb_id" }
    )
    .select()
    .single();

  if (error) {
    console.error("upsertFilm error:", error.message ?? JSON.stringify(error));
    return null;
  }
  return data;
}

export async function addFilmToSession(
  sessionId: string,
  tmdbId: number,
  participantId: string | null,
  region: Region = "AU",
): Promise<boolean> {
  const film = await upsertFilm(tmdbId, region);
  if (!film) return false;

  if (participantId) {
    // Participant explicitly adding — update added_by even if film was already seeded
    const { error } = await supabase
      .from("session_films")
      .upsert(
        { session_id: sessionId, film_id: film.id, added_by: participantId },
        { onConflict: "session_id,film_id" }
      );
    return !error;
  } else {
    // Seeder — skip silently if already exists, never overwrite a participant's added_by
    const { error } = await supabase
      .from("session_films")
      .upsert(
        { session_id: sessionId, film_id: film.id, added_by: null },
        { onConflict: "session_id,film_id", ignoreDuplicates: true }
      );
    return !error;
  }
}

export async function getSessionSwipeStats(sessionId: string): Promise<{
  totalSwipes: number;
  totalLikes: number;
  filmLikes: Map<string, string[]>;
}> {
  const { data } = await supabase
    .from("swipes")
    .select("film_id, participant_id, liked")
    .eq("session_id", sessionId);

  const swipes = data ?? [];
  const filmLikes = new Map<string, string[]>();
  let totalLikes = 0;

  for (const s of swipes as { film_id: string; participant_id: string; liked: boolean }[]) {
    if (s.liked) {
      totalLikes++;
      const ids = filmLikes.get(s.film_id) ?? [];
      ids.push(s.participant_id);
      filmLikes.set(s.film_id, ids);
    }
  }

  return { totalSwipes: swipes.length, totalLikes, filmLikes };
}

export async function getSessionFilms(sessionId: string): Promise<Film[]> {
  const { data } = await supabase
    .from("session_films")
    .select("film_id, films(*)")
    .eq("session_id", sessionId)
    .order("created_at");

  if (!data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((row) => row.films).filter(Boolean) as Film[];
}

// Returns films with metadata (which participant added them)
export async function getSessionFilmsWithMeta(
  sessionId: string
): Promise<{ film: Film; addedBy: string | null }[]> {
  const { data } = await supabase
    .from("session_films")
    .select("added_by, films(*)")
    .eq("session_id", sessionId)
    .order("created_at");

  if (!data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[])
    .map((row) => ({ film: row.films as Film, addedBy: row.added_by as string | null }))
    .filter((r) => r.film);
}

// ── Swipes ────────────────────────────────────────────────────────────────────

export async function recordSwipe(
  sessionId: string,
  participantId: string,
  filmId: string,
  liked: boolean
) {
  await supabase
    .from("swipes")
    .upsert({ session_id: sessionId, participant_id: participantId, film_id: filmId, liked });
}

export async function getMySwipes(sessionId: string, participantId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("swipes")
    .select("film_id")
    .eq("session_id", sessionId)
    .eq("participant_id", participantId);
  return new Set((data ?? []).map((s: { film_id: string }) => s.film_id));
}

export async function getMyLikes(sessionId: string, participantId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from("swipes")
    .select("film_id")
    .eq("session_id", sessionId)
    .eq("participant_id", participantId)
    .eq("liked", true);
  return new Set((data ?? []).map((s: { film_id: string }) => s.film_id));
}

// ── Match detection ───────────────────────────────────────────────────────────

// Per-participant cooldown after triggering a match. Prevents one fast-swiping
// person from creating multiple consecutive matches in a burst (issue #64).
// Concurrent matches triggered by *different* participants are unaffected — they
// each have their own cooldown row.
const MATCH_TRIGGER_COOLDOWN_MS = 5_000;

export async function checkForMatch(
  sessionId: string,
  filmId: string,
  threshold: number,
  triggeringParticipantId: string | null = null,
): Promise<boolean> {
  const [{ count: participantCount }, { data: likes }] = await Promise.all([
    supabase
      .from("participants")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId),
    supabase
      .from("swipes")
      .select("participant_id")
      .eq("session_id", sessionId)
      .eq("film_id", filmId)
      .eq("liked", true),
  ]);

  if (!participantCount || participantCount < 1) return false;
  const likeCount = (likes ?? []).length;
  const pct = (likeCount / participantCount) * 100;

  if (pct < threshold) return false;

  // Cooldown check: if this participant has already triggered a match in this
  // session within the last 5 seconds, don't write another. The first match wins.
  if (triggeringParticipantId) {
    const cutoff = new Date(Date.now() - MATCH_TRIGGER_COOLDOWN_MS).toISOString();
    const { count: recentByMe } = await supabase
      .from("matches")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .eq("triggered_by", triggeringParticipantId)
      .gte("matched_at", cutoff);
    if ((recentByMe ?? 0) > 0) return false;
  }

  // ignoreDuplicates: true so the FIRST triggered_by sticks — subsequent calls
  // for the same (session_id, film_id) no-op rather than overwriting metadata.
  // The score field becomes slightly stale on later likes but it's only used
  // for ordering matches, never as a source of truth for whether a match exists.
  await supabase.from("matches").upsert(
    { session_id: sessionId, film_id: filmId, score: likeCount, triggered_by: triggeringParticipantId },
    { onConflict: "session_id,film_id", ignoreDuplicates: true }
  );
  return true;
}

// Checks ALL films for matches in 2 DB calls instead of 2×N sequential calls.
// Upserts any matches found and returns matched film IDs.
export async function checkAllMatches(sessionId: string, threshold: number): Promise<string[]> {
  const [{ count: participantCount }, { data: swipes }] = await Promise.all([
    supabase.from("participants").select("*", { count: "exact", head: true }).eq("session_id", sessionId),
    supabase.from("swipes").select("film_id, participant_id").eq("session_id", sessionId).eq("liked", true),
  ]);
  if (!participantCount || participantCount < 1) return [];

  const likeCounts = new Map<string, Set<string>>();
  for (const s of (swipes ?? [])) {
    if (!likeCounts.has(s.film_id)) likeCounts.set(s.film_id, new Set());
    likeCounts.get(s.film_id)!.add(s.participant_id);
  }

  const matched: string[] = [];
  for (const [filmId, likers] of likeCounts.entries()) {
    if ((likers.size / participantCount) * 100 >= threshold) matched.push(filmId);
  }
  if (matched.length === 0) return [];

  // ignoreDuplicates: true so any existing match's triggered_by attribution is
  // preserved. checkAllMatches has no specific triggering participant (it's a
  // bulk reconciliation at session start), so triggered_by stays null on new rows.
  await Promise.all(matched.map((filmId) =>
    supabase.from("matches").upsert(
      { session_id: sessionId, film_id: filmId, score: likeCounts.get(filmId)!.size },
      { onConflict: "session_id,film_id", ignoreDuplicates: true }
    )
  ));
  return matched;
}

export async function resolveMatch(sessionId: string, winnerFilmId: string) {
  const { data: current } = await supabase
    .from("sessions")
    .select("status")
    .eq("id", sessionId)
    .single();

  // Only run the DB mutations once — but always attempt outcome recording below.
  // The old pattern of returning early here blocked recordSessionOutcome in the
  // shortlist and spin-wheel paths (session was already closed by that point).
  if (current?.status !== "closed") {
    // Delete all non-winner matches then close — all devices pick up the single winner
    await supabase.from("matches").delete()
      .eq("session_id", sessionId)
      .neq("film_id", winnerFilmId);
    await supabase.from("sessions").update({ status: "closed" }).eq("id", sessionId);
  }

  // Record outcome for analytics — production only, awaited so errors surface in logs.
  // Uses upsert with onConflict so simultaneous calls are safe — first write wins.
  await recordSessionOutcome(sessionId, winnerFilmId);
}

// ── Session outcomes ──────────────────────────────────────────────────────────

// Records what film a group picked, for long-term analytics.
// Skipped entirely outside production so localhost sessions don't pollute the data.
async function recordSessionOutcome(
  sessionId: string,
  winnerFilmId: string
): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;

  const [
    { data: session },
    { data: film },
    { count: groupSize },
  ] = await Promise.all([
    supabase
      .from("sessions")
      .select("region, streaming_services")
      .eq("id", sessionId)
      .single(),
    supabase
      .from("films")
      .select("tmdb_id, title, genres, release_year")
      .eq("id", winnerFilmId)
      .single(),
    supabase
      .from("participants")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId),
  ]);

  // Skip solo sessions — they're almost always a single person testing
  if (!session || !film || !groupSize || groupSize < 2) return;

  // Upsert on session_id — DB unique constraint ensures only one row per session
  // regardless of how many times this function is called (race conditions, retries).
  await supabase.from("session_outcomes").upsert({
    session_id: sessionId,
    tmdb_id: film.tmdb_id,
    film_title: film.title,
    genres: film.genres ?? null,
    release_year: film.release_year ?? null,
    group_size: groupSize ?? null,
    region: session.region ?? null,
    service_ids: session.streaming_services ?? null,
  }, { onConflict: "session_id", ignoreDuplicates: true });
}

export async function getMatches(sessionId: string): Promise<Match[]> {
  const { data } = await supabase
    .from("matches")
    .select("*, film:films(*)")
    .eq("session_id", sessionId)
    .order("score", { ascending: false });
  return data ?? [];
}

// ── Scoring for planned mode ──────────────────────────────────────────────────

export async function getFilmScores(sessionId: string): Promise<{ film: Film; score: number; total: number; likedByIds: string[] }[]> {
  const [{ data: allSwipes }, { count: total }] = await Promise.all([
    supabase.from("swipes").select("film_id, liked, participant_id").eq("session_id", sessionId),
    supabase.from("participants").select("*", { count: "exact", head: true }).eq("session_id", sessionId),
  ]);

  const swipes = allSwipes ?? [];
  const participantCount = total ?? 1;

  // Only fetch films that have at least one like — avoids loading the full 100+ film pool
  const likedFilmIds = [...new Set(swipes.filter((s) => s.liked).map((s) => s.film_id as string))];
  if (likedFilmIds.length === 0) return [];

  const { data: filmRows } = await supabase.from("films").select("*").in("id", likedFilmIds);
  const films = (filmRows ?? []) as Film[];

  return films
    .map((film) => {
      const likeSwipes = swipes.filter((s) => s.film_id === film.id && s.liked);
      return {
        film,
        score: likeSwipes.length,
        total: participantCount,
        likedByIds: likeSwipes.map((s: { participant_id: string }) => s.participant_id),
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Returns the props needed to open ShortlistOverlay from any entry point.
 * - films: all liked films (matched + also-liked), sorted by score
 * - pinnedFilmIds: the matched film IDs that are already locked in as top picks
 *
 * Both the session page and the results page should call this rather than
 * constructing their own film lists — one source of truth for shortlist data.
 */
export async function getShortlistData(
  sessionId: string,
  matchedFilmIds: string[]
): Promise<{ films: Film[]; pinnedFilmIds: string[] }> {
  const [scores, { count: groupSize }] = await Promise.all([
    getFilmScores(sessionId),
    supabase.from("participants").select("*", { count: "exact", head: true }).eq("session_id", sessionId),
  ]);

  const films = scores.map(s => s.film);
  const min = groupSize ?? 1;

  // Start with matched films as pinned
  const pinnedIds = new Set<string>(matchedFilmIds);

  // If the pinned set is smaller than the group, expand it.
  // Find the score at rank group_size in the sorted list, then include
  // every film at or above that score — never splitting a tied group.
  // e.g. 3 people, 1 matched film, non-matched: [2,2,1,1,1,1] →
  //   rank 3 score = 2 → pin all three 2-like films, leaving the 1-likes nominatable.
  if (pinnedIds.size < min && scores.length > 0) {
    const cutoffIndex = Math.min(min - 1, scores.length - 1);
    const cutoffScore = scores[cutoffIndex].score;
    for (const s of scores) {
      if (s.score >= cutoffScore) pinnedIds.add(s.film.id);
    }
  }

  return {
    films,
    pinnedFilmIds: [...pinnedIds],
  };
}
