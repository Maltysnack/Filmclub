// Canonical site constants for SEO surfaces (metadata, OG images, sitemap, robots).
// Single source of truth so the domain and core copy live in one place.

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://filmclub.watch";

export const SITE_NAME = "Filmclub";

// No em dashes per project style; a comma keeps the brand line intact.
export const SITE_TAGLINE = "Decide on a film with friends, without the argument.";

export const SITE_DESCRIPTION =
  "Can't agree on what to watch? Filmclub lets your group swipe through films Tinder-style and matches everyone on one film to watch together. No login, free.";
