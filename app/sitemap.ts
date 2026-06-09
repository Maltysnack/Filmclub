import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Static routes for now. Phase 1 adds programmatic /watch/* content pages here.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
