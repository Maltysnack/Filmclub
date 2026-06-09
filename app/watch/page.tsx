import type { Metadata } from "next";
import Link from "next/link";
import { getPublishableRegions, regionLabel, regionFlag } from "@/lib/content";
import { SITE_URL } from "@/lib/site";
import { Shell } from "@/components/content/Shell";
import { Breadcrumbs } from "@/components/content/Breadcrumbs";

export const revalidate = 86400;

export async function generateMetadata(): Promise<Metadata> {
  const title = "What to Watch: Best Movies by Streaming Service and Country";
  const description =
    "Find the best-rated movies streaming on Netflix, Disney+, Prime Video, Max and more, by country. Then pick one with friends on Filmclub.";
  return {
    title,
    description,
    alternates: { canonical: "/watch" },
    openGraph: { title: `${title} | Filmclub`, description, url: `${SITE_URL}/watch`, type: "website" },
    twitter: { card: "summary_large_image", title: `${title} | Filmclub`, description },
  };
}

export default async function Page() {
  const regions = (await getPublishableRegions())
    .map((code) => ({ code, label: regionLabel(code) ?? code, flag: regionFlag(code) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <Shell>
      <Breadcrumbs items={[{ name: "What to watch" }]} />

      <h1 className="text-2xl font-bold sm:text-3xl" style={{ color: "var(--text)" }}>
        What to Watch Tonight
      </h1>

      <p className="mt-3 text-base leading-relaxed" style={{ color: "var(--text-muted)" }}>
        The best-rated movies on every major streaming service, ranked by IMDb score and updated
        regularly. Choose your country to browse by service, or skip the scrolling and let everyone
        swipe to a match on Filmclub.
      </p>

      <h2 className="mt-8 text-lg font-semibold" style={{ color: "var(--text)" }}>
        Browse by country
      </h2>
      <ul
        className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3"
        style={{ listStyle: "none", padding: 0, margin: 0 }}
      >
        {regions.map((r) => (
          <li key={r.code}>
            <Link
              href={`/watch/${r.code.toLowerCase()}`}
              className="flex items-center gap-2 rounded-xl px-4 py-3 no-underline"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
            >
              <span aria-hidden="true">{r.flag}</span>
              <span className="font-medium">{r.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Shell>
  );
}
