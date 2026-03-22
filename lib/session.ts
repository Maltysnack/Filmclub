import { supabase } from "./supabase";
import { Session, Participant, Film, Match, WatchMode } from "@/types";
import { getFilmDetail, tmdbToFilm } from "./tmdb";
import { fetchWatchProvidersAU, getService } from "./streaming";

// ── Session code generation ───────────────────────────────────────────────────

const WORDS = [
  "WOLF", "BEAR", "HAWK", "NOVA", "DUSK", "REEL", "LENS", "NOIR",
  "GOLD", "STAR", "FILM", "EPIC", "CAGE", "CULT", "WILD", "IRON",
  "JADE", "MOON", "REEF", "SAGE",
];

export function generateCode(): string {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  return `${word}-${num}`;
}

// ── Local storage ─────────────────────────────────────────────────────────────

export function getParticipantId(sessionCode: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(`filmclub_participant_${sessionCode}`);
}

export function setParticipantId(sessionCode: string, participantId: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(`filmclub_participant_${sessionCode}`, participantId);
}

export function setIsHost(sessionCode: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(`filmclub_host_${sessionCode}`, "true");
}

export function getIsHost(sessionCode: string): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(`filmclub_host_${sessionCode}`) === "true";
}

// ── Session CRUD ──────────────────────────────────────────────────────────────

export async function createSession(
  mode: "planned" | "live",
  deadline: string | null,
  threshold: number,
  watchMode: WatchMode = "home",
  streamingServices: string[] = [],
  cinemaDate: string | null = null,
  cinemaTimeFrom: string | null = null,
  cinemaTimeTo: string | null = null,
): Promise<Session | null> {
  let code = generateCode();
  const { data: existing } = await supabase.from("sessions").select("id").eq("code", code).single();
  if (existing) code = generateCode();

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      code, mode, deadline, threshold,
      watch_mode: watchMode,
      streaming_services: streamingServices,
      cinema_date: cinemaDate,
      cinema_time_from: cinemaTimeFrom,
      cinema_time_to: cinemaTimeTo,
    })
    .select()
    .single();

  if (error) { console.error(error); return null; }
  return data;
}

export async function getSession(code: string): Promise<Session | null> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("code", code.toUpperCase())
    .single();
  if (error) return null;
  return data;
}

export async function closeSession(sessionId: string) {
  await supabase.from("sessions").update({ status: "closed" }).eq("id", sessionId);
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

export async function upsertFilm(tmdbId: number): Promise<Film | null> {
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
      hasWrongIds;
    if (needsRefresh) {
      const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY ?? "";
      const fresh = await fetchWatchProvidersAU(tmdbId, apiKey);
      // Always update the DB (even if fresh is empty — marks the film as "checked")
      await supabase
        .from("films")
        .update({ watch_providers_au: fresh })
        .eq("id", cached.id);
      return { ...cached, watch_providers_au: fresh };
    }
    return cached;
  }

  // Fetch from TMDB and cache
  const detail = await getFilmDetail(tmdbId);
  if (!detail) return null;

  const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY ?? "";
  const [filmData, watchProviders] = await Promise.all([
    Promise.resolve(tmdbToFilm(detail)),
    fetchWatchProvidersAU(tmdbId, apiKey),
  ]);

  const { data, error } = await supabase
    .from("films")
    .upsert({ ...filmData, watch_providers_au: watchProviders }, { onConflict: "tmdb_id" })
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
  participantId: string | null
): Promise<boolean> {
  const film = await upsertFilm(tmdbId);
  if (!film) return false;

  const { error } = await supabase
    .from("session_films")
    .upsert(
      { session_id: sessionId, film_id: film.id, added_by: participantId },
      { onConflict: "session_id,film_id", ignoreDuplicates: true }
    );

  return !error;
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

// ── Match detection ───────────────────────────────────────────────────────────

export async function checkForMatch(
  sessionId: string,
  filmId: string,
  threshold: number
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

  if (pct >= threshold) {
    await supabase.from("matches").upsert(
      { session_id: sessionId, film_id: filmId, score: likeCount },
      { onConflict: "session_id,film_id" }
    );
    return true;
  }
  return false;
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
  const [films, { data: allSwipes }, { count: total }] = await Promise.all([
    getSessionFilms(sessionId),
    supabase
      .from("swipes")
      .select("film_id, liked, participant_id")
      .eq("session_id", sessionId),
    supabase
      .from("participants")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId),
  ]);

  const swipes = allSwipes ?? [];
  const participantCount = total ?? 1;

  return films
    .map((film) => {
      const filmSwipes = swipes.filter((s: { film_id: string; liked: boolean; participant_id: string }) => s.film_id === film.id);
      const likeSwipes = filmSwipes.filter((s: { liked: boolean }) => s.liked);
      return {
        film,
        score: likeSwipes.length,
        total: participantCount,
        likedByIds: likeSwipes.map((s: { participant_id: string }) => s.participant_id),
      };
    })
    .sort((a, b) => b.score - a.score);
}
