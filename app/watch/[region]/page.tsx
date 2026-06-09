import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import {
  getPublishableRegions,
  getRegionServices,
  regionLabel,
  regionFlag,
  isValidRegion,
} from "@/lib/content";
import { SITE_URL } from "@/lib/site";
import { Shell } from "@/components/content/Shell";
import { Breadcrumbs } from "@/components/content/Breadcrumbs";

export const revalidate = 86400;
export const dynamicParams = true;

type Params = { region: string };

export async function generateStaticParams() {
  const regions = await getPublishableRegions();
  return regions.map((r) => ({ region: r.toLowerCase() }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { region: regionParam } = await params;
  const region = regionParam.toUpperCase();
  if (!isValidRegion(region)) return {};
  const rl = regionLabel(region);
  if (!rl) return {};
  const year = new Date().getFullYear();
  const title = `What to Watch in ${rl}: Best Movies by Streaming Service (${year})`;
  const description = `Browse the best-rated movies streaming in ${rl}, by service: Netflix, Disney+, Prime Video and more. Pick together with friends on Filmclub.`;
  const path = `/watch/${region.toLowerCase()}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title: `${title} | Filmclub`, description, url: `${SITE_URL}${path}`, type: "website" },
    twitter: { card: "summary_large_image", title: `${title} | Filmclub`, description },
  };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { region: regionParam } = await params;
  const region = regionParam.toUpperCase();
  if (!isValidRegion(region)) notFound();
  const rl = regionLabel(region);
  if (!rl) notFound();

  const services = await getRegionServices(region);
  if (services.length === 0) notFound();

  return (
    <Shell>
      <Breadcrumbs items={[{ name: "What to watch", href: "/watch" }, { name: rl }]} />

      <h1 className="text-2xl font-bold sm:text-3xl" style={{ color: "var(--text)" }}>
        What to Watch in {rl} {regionFlag(region)}
      </h1>

      <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--text-muted)" }}>
        The best-rated movies streaming in {rl} right now, by service. Pick a streaming service to
        see its top films, or start a Filmclub and swipe through them with friends.
      </p>

      <ul className="mt-6 flex flex-col gap-3" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {services.map((s) => (
          <li key={s.service}>
            <Link
              href={`/watch/${region.toLowerCase()}/${s.service}`}
              className="flex items-center justify-between rounded-xl px-4 py-3 no-underline"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <span className="font-semibold" style={{ color: "var(--text)" }}>
                Best movies on {s.name}
              </span>
              <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                {s.count} films →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
