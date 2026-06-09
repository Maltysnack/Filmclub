import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { getPublishableCombos, getPublishableRegions } from "@/lib/content";

export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const [combos, regions] = await Promise.all([
    getPublishableCombos(),
    getPublishableRegions(),
  ]);

  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/watch`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    ...regions.map((r) => ({
      url: `${SITE_URL}/watch/${r.toLowerCase()}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    ...combos.map((c) => ({
      url: `${SITE_URL}/watch/${c.region.toLowerCase()}/${c.service}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
