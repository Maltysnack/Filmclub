import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Sessions are transient (cleaned up after 3 days) and private to a group,
      // so keep them out of the index to avoid soft-404s. API routes aren't content.
      disallow: ["/session/", "/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
