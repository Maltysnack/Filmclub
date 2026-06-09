import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  getPublishableCombos,
  getServiceFilms,
  serviceLabel,
  regionLabel,
  regionFlag,
  isValidRegion,
  MIN_FILMS,
} from "@/lib/content";
import { SITE_URL } from "@/lib/site";
import type { Region } from "@/types";
import { Shell } from "@/components/content/Shell";
import { Breadcrumbs } from "@/components/content/Breadcrumbs";
import { RankedFilms } from "@/components/content/RankedFilms";
import { StartCta } from "@/components/content/StartCta";
import { JsonLd } from "@/components/JsonLd";

export const revalidate = 86400;
export const dynamicParams = true;

type Params = { region: string; service: string };

export async function generateStaticParams() {
  const combos = await getPublishableCombos();
  return combos.map((c) => ({ region: c.region.toLowerCase(), service: c.service }));
}

function resolve(p: Params): { region: Region; service: string; svc: string; rl: string } | null {
  const region = p.region.toUpperCase();
  if (!isValidRegion(region)) return null;
  const svc = serviceLabel(region, p.service);
  const rl = regionLabel(region);
  if (!svc || !rl) return null;
  return { region, service: p.service, svc, rl };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const r = resolve(await params);
  if (!r) return {};
  const year = new Date().getFullYear();
  const title = `Best Movies on ${r.svc} in ${r.rl} (${year})`;
  const description = `The best-rated movies streaming on ${r.svc} in ${r.rl} right now, ranked by IMDb score. Can't decide what to watch? Swipe with friends on Filmclub and match in minutes.`;
  const path = `/watch/${r.region.toLowerCase()}/${r.service}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title: `${title} | Filmclub`, description, url: `${SITE_URL}${path}`, type: "website" },
    twitter: { card: "summary_large_image", title: `${title} | Filmclub`, description },
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const r = resolve(await params);
  if (!r) notFound();
  const films = await getServiceFilms(r.region, r.service);
  if (films.length < MIN_FILMS) notFound();

  const year = new Date().getFullYear();
  const updated = new Date().toLocaleString("en", { month: "long", year: "numeric" });
  const top = films[0];

  // ItemList of Movies. No aggregateRating — fabricating ratingCount risks a
  // structured-data spam flag, so we only assert position/name/year.
  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `Best Movies on ${r.svc} in ${r.rl}`,
    numberOfItems: films.length,
    itemListElement: films.map((f, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "Movie",
        name: f.title,
        ...(f.year ? { datePublished: String(f.year) } : {}),
      },
    })),
  };

  return (
    <Shell>
      <Breadcrumbs
        items={[
          { name: "What to watch", href: "/watch" },
          { name: r.rl, href: `/watch/${r.region.toLowerCase()}` },
          { name: r.svc },
        ]}
      />

      <h1 className="text-2xl font-bold sm:text-3xl" style={{ color: "var(--text)" }}>
        Best Movies on {r.svc} in {r.rl} {regionFlag(r.region)}{" "}
        <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({year})</span>
      </h1>

      <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--text-muted)" }}>
        These are the {films.length} best-rated films streaming on {r.svc} in {r.rl} right now,
        ranked by IMDb score
        {top?.imdbRating != null ? `, from ${top.title} (${top.imdbRating.toFixed(1)}) down` : ""}. Updated{" "}
        {updated}.
      </p>

      <StartCta serviceName={r.svc} />

      <RankedFilms films={films} />

      <JsonLd data={itemListLd} />
    </Shell>
  );
}
