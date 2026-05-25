import { createClient } from "@supabase/supabase-js";
import { fetchWatchProviders } from "@/lib/streaming";
import { getFilmDetail } from "@/lib/tmdb";
import type { Region } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Server-side films refresh. Replaces the direct client UPDATE that #108
// removed from the anon role's RLS. The service-role client used here is
// the only writer to films.UPDATE in the app surface (crons in
// /api/cron/* use their own service-role clients).
//
// Request body: { tmdbId: number, region?: string }
// Response: the refreshed films row, or 404 if no cached row exists.
//
// No auth on the route — the work it does is strictly bounded to "refetch
// this tmdbId from TMDB and write the result". Rate-limiting belongs in #47.

const REGION_RE = /^[A-Z]{2}$/;

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  if (!body || typeof body !== "object") return new Response("bad body", { status: 400 });

  const { tmdbId, region: rawRegion } = body as { tmdbId?: unknown; region?: unknown };
  if (typeof tmdbId !== "number" || tmdbId <= 0 || !Number.isFinite(tmdbId)) {
    return new Response("bad tmdbId", { status: 400 });
  }
  const region: Region = typeof rawRegion === "string" && REGION_RE.test(rawRegion)
    ? (rawRegion as Region)
    : "AU";

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: cached, error: lookupErr } = await sb
    .from("films")
    .select("*")
    .eq("tmdb_id", tmdbId)
    .single();
  if (lookupErr || !cached) return new Response("not found", { status: 404 });

  const apiKey = process.env.NEXT_PUBLIC_TMDB_API_KEY ?? "";
  const needsDetail = !cached.imdb_id || cached.collection_id == null;

  const settled = await Promise.allSettled([
    fetchWatchProviders(tmdbId, apiKey, region),
    needsDetail ? getFilmDetail(tmdbId) : Promise.resolve(null),
  ]);
  const fresh = settled[0].status === "fulfilled" ? settled[0].value : [];
  const detail = settled[1].status === "fulfilled" ? settled[1].value : null;

  const existingProviders = (cached.watch_providers_au as Array<{ logoPath?: string | null }> | null) ?? [];
  const providerUpdate = fresh.length > 0 || existingProviders.length === 0 ? fresh : existingProviders;

  const updates: Record<string, unknown> = { watch_providers_au: providerUpdate };
  const imdbId = detail?.imdb_id ?? cached.imdb_id ?? null;
  if (imdbId) updates.imdb_id = imdbId;
  if (detail) {
    updates.collection_id = detail.belongs_to_collection?.id ?? 0;
    updates.collection_name = detail.belongs_to_collection?.name ?? null;
  }

  const { data: updated, error: updErr } = await sb
    .from("films")
    .update(updates)
    .eq("id", cached.id)
    .select()
    .single();
  if (updErr || !updated) return new Response("update failed", { status: 500 });

  return Response.json(updated);
}
