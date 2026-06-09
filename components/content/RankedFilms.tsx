import type { ContentFilm } from "@/lib/content";

// TMDB image CDN serves correctly-sized posters already, so we use a plain
// <img> (lazy, fixed dimensions to avoid CLS) instead of next/image. At 100+
// pages x up to 40 posters, routing these through Vercel's image optimizer
// would blow the transformation quota for no quality gain.
const POSTER = "https://image.tmdb.org/t/p/w185";

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n).replace(/\s+\S*$/, "") + "…";
}

export function RankedFilms({ films }: { films: ContentFilm[] }) {
  return (
    <ol className="flex flex-col gap-4" style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {films.map((f, i) => (
        <li
          key={f.tmdbId}
          className="flex gap-4 rounded-xl p-3"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="flex shrink-0 items-start gap-3">
            <span
              className="w-5 pt-1 text-right text-sm font-bold tabular-nums"
              style={{ color: "var(--text-muted)" }}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            {f.posterPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${POSTER}${f.posterPath}`}
                alt={`${f.title} poster`}
                width={70}
                height={105}
                loading="lazy"
                className="rounded-md"
                style={{ width: 70, height: 105, objectFit: "cover" }}
              />
            ) : (
              <div className="rounded-md" style={{ width: 70, height: 105, background: "var(--surface-2)" }} />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold leading-snug" style={{ color: "var(--text)" }}>
              {f.title}
              {f.year ? (
                <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> ({f.year})</span>
              ) : null}
            </h3>

            <div
              className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
              style={{ color: "var(--text-muted)" }}
            >
              {f.imdbRating != null && (
                <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                  ★ {f.imdbRating.toFixed(1)} IMDb
                </span>
              )}
              {f.runtime ? <span>{f.runtime} min</span> : null}
              {f.genres.length > 0 && <span>{f.genres.slice(0, 3).join(", ")}</span>}
            </div>

            {f.overview && (
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {truncate(f.overview, 200)}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
