import { supabase } from "./supabase";
import { ShortlistRound, ShortlistVeto, ShortlistVote } from "@/types";

/** Host only. Creates round 1 with phase 'nominate' so all participants get the INSERT signal
 *  and open the nomination UI before any films are locked in. */
export async function startNomination(
  sessionId: string,
  pinnedFilmIds: string[]
): Promise<ShortlistRound | null> {
  const { data, error } = await supabase
    .from("shortlist_rounds")
    .insert({ session_id: sessionId, round_number: 1, film_ids: pinnedFilmIds, phase: "nominate" })
    .select()
    .single();
  if (error) {
    // Likely a duplicate — another device already created the round. Fetch it instead.
    return getCurrentRound(sessionId);
  }
  return data;
}

/** Host only. Advances the nomination round to veto/vote with the final film set.
 *  Deletes nomination submissions first so they don't bleed into the veto/vote phases. */
export async function advanceFromNomination(
  sessionId: string,
  roundId: string,
  finalFilmIds: string[]
): Promise<void> {
  await supabase.from("shortlist_votes").delete()
    .eq("session_id", sessionId).eq("round_number", 1);
  await supabase
    .from("shortlist_rounds")
    .update({ film_ids: finalFilmIds, phase: finalFilmIds.length <= 2 ? "vote" : "veto" })
    .eq("id", roundId)
    .eq("phase", "nominate");
}

export async function startShortlist(
  sessionId: string,
  filmIds: string[]
): Promise<ShortlistRound | null> {
  const { data, error } = await supabase
    .from("shortlist_rounds")
    .insert({
      session_id: sessionId,
      round_number: 1,
      film_ids: filmIds,
      phase: filmIds.length <= 2 ? "vote" : "veto",
    })
    .select()
    .single();
  if (error) { console.error(error); return null; }
  return data;
}

export async function getCurrentRound(sessionId: string): Promise<ShortlistRound | null> {
  const { data } = await supabase
    .from("shortlist_rounds")
    .select("*")
    .eq("session_id", sessionId)
    .order("round_number", { ascending: false })
    .limit(1)
    .single();
  return data ?? null;
}

// Verify the given participant actually belongs to this session before
// recording a vote/veto on their behalf. Without this, any client could
// pass any participant_id and submit votes as anyone in the session (#50).
async function assertParticipantInSession(sessionId: string, participantId: string): Promise<boolean> {
  const { data } = await supabase
    .from("participants")
    .select("id")
    .eq("id", participantId)
    .eq("session_id", sessionId)
    .maybeSingle();
  return !!data;
}

export async function submitVeto(
  sessionId: string,
  roundNumber: number,
  participantId: string,
  filmId: string
): Promise<void> {
  if (!(await assertParticipantInSession(sessionId, participantId))) {
    console.warn("[submitVeto] participant not in session, ignored", { sessionId, participantId });
    return;
  }
  await supabase.from("shortlist_vetoes").upsert(
    { session_id: sessionId, round_number: roundNumber, participant_id: participantId, film_id: filmId },
    { onConflict: "session_id,round_number,participant_id" }
  );
}

export async function getVetoes(
  sessionId: string,
  roundNumber: number
): Promise<ShortlistVeto[]> {
  const { data } = await supabase
    .from("shortlist_vetoes")
    .select("*")
    .eq("session_id", sessionId)
    .eq("round_number", roundNumber);
  return data ?? [];
}

/** Host only. Moves veto → vote with the surviving films. Returns false if another device got there first. */
export async function advanceToVotePhase(
  sessionId: string,
  roundNumber: number,
  remainingFilmIds: string[]
): Promise<boolean> {
  const { data } = await supabase
    .from("shortlist_rounds")
    .update({ phase: "vote", film_ids: remainingFilmIds })
    .eq("session_id", sessionId)
    .eq("round_number", roundNumber)
    .eq("phase", "veto")
    .select();
  return (data ?? []).length > 0;
}

export async function submitVotes(
  sessionId: string,
  roundNumber: number,
  participantId: string,
  filmIds: string[]
): Promise<void> {
  if (!(await assertParticipantInSession(sessionId, participantId))) {
    console.warn("[submitVotes] participant not in session, ignored", { sessionId, participantId });
    return;
  }
  await supabase.from("shortlist_votes").upsert(
    { session_id: sessionId, round_number: roundNumber, participant_id: participantId, film_ids: filmIds },
    { onConflict: "session_id,round_number,participant_id" }
  );
}

export async function getVotes(
  sessionId: string,
  roundNumber: number
): Promise<ShortlistVote[]> {
  const { data } = await supabase
    .from("shortlist_votes")
    .select("*")
    .eq("session_id", sessionId)
    .eq("round_number", roundNumber);
  return data ?? [];
}

/** How many votes each person gets for a given pool size (1 per 5 films). */
export function votesAllowed(filmCount: number): number {
  return Math.ceil(filmCount / 5);
}

/**
 * Pure function — tallies votes with survival-filter logic.
 * - 1 film unanimous → immediate winner.
 * - 2+ films unanimous → spin between them (#128: previously returned
 *   the first-iterated unanimous arbitrarily).
 * - 2-film round → plurality wins; exact tie → spin.
 * - Otherwise → survival filter (≥1 vote stays).
 *   All survived (no zeros) OR 2+ survivors → next veto+vote round.
 *   1 survivor → winner.
 */
export function tallyVotes(
  filmIds: string[],
  votes: ShortlistVote[],
  totalParticipants: number
): { winner: string } | { tied: string[] } | { survivors: string[] } {
  const counts = new Map<string, number>();
  for (const id of filmIds) counts.set(id, 0);
  for (const vote of votes) {
    for (const id of vote.film_ids) {
      if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  // Unanimous — collect every film that every participant voted for
  const unanimous: string[] = [];
  for (const [id, count] of counts) {
    if (count === totalParticipants) unanimous.push(id);
  }
  if (unanimous.length === 1) return { winner: unanimous[0] };
  if (unanimous.length >= 2) return { tied: unanimous };

  // Final vote: only 2 films — use plurality, tie → spin
  if (filmIds.length === 2) {
    const [a, b] = filmIds;
    const ca = counts.get(a) ?? 0;
    const cb = counts.get(b) ?? 0;
    if (ca > cb) return { winner: a };
    if (cb > ca) return { winner: b };
    return { tied: [a, b] };
  }

  // Survival filter — any film with ≥1 vote survives
  const survivors = filmIds.filter(id => (counts.get(id) ?? 0) > 0);

  // Edge cases: no survivors or all survived → keep everyone, next round
  if (survivors.length === 0 || survivors.length === filmIds.length) {
    return { survivors: filmIds };
  }

  if (survivors.length === 1) return { winner: survivors[0] };

  // 2+ survivors → next veto+vote round with just them
  return { survivors };
}

/** Host only. Starts the next round with the tied films. */
export async function advanceToNextRound(
  sessionId: string,
  nextRoundNumber: number,
  filmIds: string[]
): Promise<ShortlistRound | null> {
  const { data, error } = await supabase
    .from("shortlist_rounds")
    .insert({
      session_id: sessionId,
      round_number: nextRoundNumber,
      film_ids: filmIds,
      phase: filmIds.length <= 2 ? "vote" : "veto",
    })
    .select()
    .single();
  if (error) { console.error(error); return null; }
  return data;
}

/** Host only. Writes the spin state to the DB so non-hosts who miss the broadcast
 *  still transition to the spin screen via their Postgres subscription. */
export async function markSpinning(
  sessionId: string,
  roundNumber: number,
  winnerId: string,
  filmIds: string[]
): Promise<void> {
  await supabase
    .from("shortlist_rounds")
    .update({ phase: "spinning", winner_id: winnerId, film_ids: filmIds })
    .eq("session_id", sessionId)
    .eq("round_number", roundNumber);
}

/** Host only. Marks the shortlist complete with a winner. */
export async function completeShortlist(
  sessionId: string,
  roundNumber: number,
  winnerId: string
): Promise<void> {
  await supabase
    .from("shortlist_rounds")
    .update({ phase: "complete", winner_id: winnerId })
    .eq("session_id", sessionId)
    .eq("round_number", roundNumber);
}
