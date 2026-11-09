"use client";

import { useEffect, useState } from "react";
import { imdbLink, letterboxdLink } from "@/lib/images";
import { logoUrl, serviceById } from "@/lib/services";
import type { Film } from "@/lib/types";

export interface Detail {
  imdb: string | null;
  imdbId: string | null;
  runtime: number | null;
  cast: string[];
}

const cache = new Map<number, Promise<Detail | null>>();

// A failed lookup is forgotten, so the next time the film comes up it is tried again.
function fetchDetail(id: number) {
  let found = cache.get(id);
  if (!found) {
    const request: Promise<Detail | null> = fetch(`/api/film/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    request.then((detail) => {
      if (!detail) cache.delete(id);
    });
    found = request;
    cache.set(id, found);
  }
  return found;
}

// Called for the cards behind the front one, so ratings are there when each card arrives.
export function prefetchDetail(id: number) {
  void fetchDetail(id);
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

export function ServiceLogos({ film, className = "size-5" }: { film: Film; className?: string }) {
  return film.services.map((id) => {
    const service = serviceById(id);
    // eslint-disable-next-line @next/next/no-img-element
    return service && <img key={id} src={logoUrl(service.logo)} alt={service.name} className={className} />;
  });
}

export default function FilmInfo({ film, likedBy, onClose }: { film: Film; likedBy: string[]; onClose: () => void }) {
  const detail = useDetail(film.id);
  return (
    <div role="dialog" aria-label={`About ${film.title}`} className="absolute inset-0 z-30 flex flex-col gap-4 overflow-y-auto bg-black/95 px-6 pb-6 pt-14">
      <div className="column flex flex-1 flex-col gap-4">
        <h2 className="display text-[34px]">{film.title}</h2>
        <div className="flex items-center gap-2">
          <p className="label mr-1 text-muted">{[film.year, detail?.runtime && `${detail.runtime} min`].filter(Boolean).join(" / ")}</p>
          <ServiceLogos film={film} className="size-7" />
        </div>
        {likedBy.length > 0 && <p className="label">{likedBy.join(", ")} liked this</p>}
        <p className="text-[15px] leading-relaxed">{film.overview}</p>
        {detail && detail.cast.length > 0 && <p className="text-sm leading-relaxed text-muted">{detail.cast.join(", ")}</p>}
        <div className="grid grid-cols-2 gap-px border border-line bg-line">
          <a href={detail?.imdbId ? imdbLink(detail.imdbId) : undefined} target="_blank" rel="noopener noreferrer" aria-label="IMDb" className="flex h-11 items-center justify-center gap-2 bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/imdb-logo.png" alt="" className="h-4 w-auto" />
            {/* Blank while loading, so a slow lookup never looks like a film with no rating. */}
            <span className="display text-[16px]">{detail ? (detail.imdb ?? "N/A") : ""}</span>
          </a>
          <a href={letterboxdLink(film.id)} target="_blank" rel="noopener noreferrer" aria-label="Letterboxd" className="flex h-11 items-center justify-center bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/letterboxd-logo.svg" alt="" className="h-5 w-auto" />
          </a>
        </div>
        <button className="slab mt-auto" onClick={onClose}>Back</button>
      </div>
    </div>
  );
}
