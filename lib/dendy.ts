import * as cheerio from "cheerio";
import { supabase } from "./supabase";

const DENDY_BASE = "https://newtown.dendy.com.au";

export interface DendyFilm {
  slug: string;
  title: string;
  tmdbId: number | null;
  tmdbMatch: "high" | "low" | "none";
  sessionDate: string;        // ISO date: "2026-03-22"
  sessionTimes: string[];     // ["6:00 pm", "7:30 pm"]
  bookingUrls: Record<string, string>; // { "6:00 pm": "https://..." }
}

// ── Scraping ──────────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Filmclub/1.0 (filmclub app; personal use)" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

// Parse "March 22, 10:00 am" → "2026-03-22"
function parseDate(raw: string): string | null {
  try {
    const d = new Date(`${raw} ${new Date().getFullYear()}`);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

// Parse "6:00 pm" → minutes since midnight (for range comparisons)
export function timeToMinutes(t: string): number {
  const match = t.match(/(\d+):(\d+)\s*(am|pm)/i);
  if (!match) return 0;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ampm = match[3].toLowerCase();
  if (ampm === "pm" && h !== 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  return h * 60 + m;
}

async function scrapeNowShowing(): Promise<{ slug: string; title: string }[]> {
  const html = await fetchHtml(`${DENDY_BASE}/now-showing/`);
  if (!html) return [];

  const $ = cheerio.load(html);
  const films: { slug: string; title: string }[] = [];
  const seen = new Set<string>();

  $("a[href*='/movie/']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const match = href.match(/\/movie\/([^/]+)\/?$/);
    if (!match) return;
    const slug = match[1];
    if (seen.has(slug)) return;
    seen.add(slug);
    const title = $(el).text().trim();
    if (title) films.push({ slug, title });
  });

  return films;
}

async function scrapeFilmSessions(
  slug: string
): Promise<{ date: string; time: string; url: string }[]> {
  const html = await fetchHtml(`${DENDY_BASE}/movie/${slug}/`);
  if (!html) return [];

  const $ = cheerio.load(html);
  const sessions: { date: string; time: string; url: string }[] = [];

  $("a[href*='/checkout/showing/']").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().trim();

    // Text is like "March 22, 10:00 am" or just "10:00 am"
    // Try to extract date + time
    const fullMatch = text.match(/^([A-Za-z]+ \d+),\s*(\d+:\d+\s*[ap]m)$/i);
    const timeOnlyMatch = text.match(/^(\d+:\d+\s*[ap]m)$/i);

    if (fullMatch) {
      const date = parseDate(fullMatch[1]);
      if (date) sessions.push({ date, time: fullMatch[2].toLowerCase(), url: href });
    } else if (timeOnlyMatch) {
      // No date in text — skip (we can't tell which day)
    }
  });

  return sessions;
}

// Simple title similarity — normalise and compare
function titleSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;

  // Word overlap
  const wa = new Set(na.split(" "));
  const wb = new Set(nb.split(" "));
  const intersection = [...wa].filter((w) => wb.has(w)).length;
  return (2 * intersection) / (wa.size + wb.size);
}

async function matchTmdb(
  title: string,
  apiKey: string
): Promise<{ tmdbId: number | null; confidence: "high" | "low" | "none" }> {
  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(title)}&language=en-US`;
    const res = await fetch(url);
    if (!res.ok) return { tmdbId: null, confidence: "none" };
    const data = await res.json();
    const results = data.results ?? [];
    if (!results.length) return { tmdbId: null, confidence: "none" };

    const top = results[0];
    const sim = titleSimilarity(title, top.title ?? "");

    if (sim >= 0.9) return { tmdbId: top.id, confidence: "high" };
    if (sim >= 0.5) return { tmdbId: top.id, confidence: "low" };
    return { tmdbId: null, confidence: "none" };
  } catch {
    return { tmdbId: null, confidence: "none" };
  }
}

// ── Main scrape + cache ───────────────────────────────────────────────────────

export async function scrapeDendy(apiKey: string): Promise<void> {
  const films = await scrapeNowShowing();
  if (!films.length) return;

  // Scrape all film pages in parallel (batched to avoid hammering the site)
  const BATCH = 5;
  for (let i = 0; i < films.length; i += BATCH) {
    const batch = films.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async ({ slug, title }) => {
        const sessions = await scrapeFilmSessions(slug);
        if (!sessions.length) return;

        const { tmdbId, confidence } = await matchTmdb(title, apiKey);

        // Group sessions by date
        const byDate = new Map<string, { times: string[]; urls: Record<string, string> }>();
        for (const { date, time, url } of sessions) {
          if (!byDate.has(date)) byDate.set(date, { times: [], urls: {} });
          const entry = byDate.get(date)!;
          if (!entry.times.includes(time)) {
            entry.times.push(time);
            entry.urls[time] = url;
          }
        }

        // Upsert into Supabase
        await Promise.all(
          [...byDate.entries()].map(([date, { times, urls }]) =>
            supabase.from("dendy_sessions").upsert(
              {
                film_slug: slug,
                film_title: title,
                tmdb_id: tmdbId,
                tmdb_match: confidence,
                session_date: date,
                session_times: times.sort((a, b) => timeToMinutes(a) - timeToMinutes(b)),
                booking_urls: urls,
                scraped_at: new Date().toISOString(),
              },
              { onConflict: "film_slug,session_date" }
            )
          )
        );
      })
    );
    // Small delay between batches
    if (i + BATCH < films.length) await new Promise((r) => setTimeout(r, 500));
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

export async function getDendySessions(
  date: string,
  fromTime?: string, // "18:00"
  toTime?: string    // "20:00"
): Promise<DendyFilm[]> {
  const { data } = await supabase
    .from("dendy_sessions")
    .select("*")
    .eq("session_date", date)
    .order("film_title");

  if (!data) return [];

  return data
    .map((row) => {
      let times: string[] = row.session_times ?? [];

      // Filter by time window if provided
      if (fromTime || toTime) {
        const fromMins = fromTime ? timeToMinutes(fromTime.replace(":", ":") + " pm").toString() : null;
        // Parse "18:00" -> minutes
        const parseHHMM = (t: string) => {
          const [h, m] = t.split(":").map(Number);
          return h * 60 + m;
        };
        const fromM = fromTime ? parseHHMM(fromTime) : 0;
        const toM = toTime ? parseHHMM(toTime) : 24 * 60;
        times = times.filter((t) => {
          const mins = timeToMinutes(t);
          return mins >= fromM && mins <= toM;
        });
        if (!times.length) return null;
      }

      return {
        slug: row.film_slug,
        title: row.film_title,
        tmdbId: row.tmdb_id ?? null,
        tmdbMatch: row.tmdb_match as "high" | "low" | "none",
        sessionDate: row.session_date,
        sessionTimes: times,
        bookingUrls: row.booking_urls ?? {},
      } as DendyFilm;
    })
    .filter(Boolean) as DendyFilm[];
}
