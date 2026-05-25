// Rate limiting via Upstash Redis (#47).
//
// Activates only when UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
// are set in env. Until then this module returns { allowed: true } on every
// call — endpoints stay open. Once provisioning lands, set the env vars in
// Vercel and rate limiting becomes effective immediately, no code change.
//
// Provisioning steps (one-time, manual):
//   1. Vercel Marketplace → install Upstash Redis (free tier covers this app).
//   2. The integration auto-sets UPSTASH_REDIS_REST_URL and _TOKEN in the
//      project's env. Redeploy or pull env locally.
//   3. Verify in a Vercel function log: "rate-limit active" debug line.
//
// Usage from a route handler:
//   const result = await checkRateLimit("feedback", req);
//   if (!result.allowed) return new Response("rate limited", { status: 429 });

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ENABLED = !!(URL && TOKEN);

// Per-endpoint configs. Tune per real-world abuse patterns.
// Sliding window — fairer than fixed-window for bursty legit traffic.
const CONFIGS: Record<string, { limit: number; window: `${number} ${"s" | "m" | "h"}` }> = {
  feedback: { limit: 5, window: "1 h" },         // 5 submissions per IP per hour
  filmsRefresh: { limit: 60, window: "1 m" },    // 60 refreshes per IP per minute
};

const redis = ENABLED ? new Redis({ url: URL!, token: TOKEN! }) : null;

// Cache limiter instances so each route handler shares one across requests.
const limiters = new Map<string, Ratelimit>();
function getLimiter(key: string): Ratelimit | null {
  if (!redis) return null;
  const cached = limiters.get(key);
  if (cached) return cached;
  const cfg = CONFIGS[key];
  if (!cfg) throw new Error(`unknown rate-limit key: ${key}`);
  const fresh = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(cfg.limit, cfg.window),
    prefix: `rl:${key}`,
  });
  limiters.set(key, fresh);
  return fresh;
}

// Derives a per-caller identifier from the request. Vercel sets x-forwarded-for
// reliably; fallback to a constant so behind-LB traffic still gets some limit
// rather than going unlimited.
function identify(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}

export async function checkRateLimit(
  key: keyof typeof CONFIGS,
  req: Request,
): Promise<{ allowed: boolean; remaining?: number }> {
  const limiter = getLimiter(key);
  if (!limiter) return { allowed: true }; // env not provisioned → permissive
  const id = identify(req);
  const { success, remaining } = await limiter.limit(id);
  return { allowed: success, remaining };
}
