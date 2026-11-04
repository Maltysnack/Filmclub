"use client";

import { useEffect, useState } from "react";
import { imdbLink, letterboxdLink } from "@/lib/images";
import { serviceById } from "@/lib/services";
import type { Film } from "@/lib/types";

export interface Detail {
  imdb: string | null;
  imdbId: string | null;
  runtime: number | null;
  cast: string[];
}

const cache = new Map<number, Promise<Detail | null>>();

function fetchDetail(id: number) {
  let found = cache.get(id);
  if (!found) {
    found = fetch(`/api/film/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    cache.set(id, found);
  }
  return found;
}

export function useDetail(id: number) {
  const [loaded, setLoaded] = useState<{ id: number; detail: Detail | null } | null>(null);
  useEffect(() => {
    let live = true;
    fetchDetail(id).then((detail) => live && setLoaded({ id, detail }));
    return () => {
      live = false;
    };
  }, [id]);
  return loaded?.id === id ? loaded.detail : null;
}

export default function FilmInfo({ film, likedBy, onClose }: { film: Film; likedBy: string[]; onClose: () => void }) {
  const detail = useDetail(film.id);
  const services = film.services.map((s) => serviceById(s)?.name).filter(Boolean);
  return (
    <div role="dialog" aria-label={`About ${film.title}`} className="absolute inset-0 z-30 flex flex-col gap-4 overflow-y-auto bg-black/95 px-6 pb-6 pt-14">
      <div className="column flex flex-1 flex-col gap-4">
        <h2 className="display text-[34px]">{film.title}</h2>
        <p className="label text-muted">
          {[film.year, detail?.runtime && `${detail.runtime} min`, services.join(", ")].filter(Boolean).join(" / ")}
        </p>
        {likedBy.length > 0 && <p className="label">{likedBy.join(", ")} liked this</p>}
        <p className="text-[15px] leading-relaxed">{film.overview}</p>
        {detail && detail.cast.length > 0 && <p className="text-sm leading-relaxed text-muted">{detail.cast.join(", ")}</p>}
        <div className="grid grid-cols-2 gap-px border border-line bg-line">
          <a href={detail?.imdbId ? imdbLink(detail.imdbId) : undefined} target="_blank" rel="noopener noreferrer" className="bg-black p-3.5">
            <span className="label block text-muted">IMDb</span>
            <span className="display mt-1 block text-[26px]">{detail?.imdb ?? "N/A"}</span>
          </a>
          <a href={letterboxdLink(film.id)} target="_blank" rel="noopener noreferrer" className="bg-black p-3.5">
            <span className="label block text-muted">Letterboxd</span>
            <span className="mt-2 block text-sm">Open page</span>
          </a>
        </div>
        <button className="slab mt-auto" onClick={onClose}>Back to swiping</button>
      </div>
    </div>
  );
}
