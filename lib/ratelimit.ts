import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type Window = `${number} ${"s" | "m" | "h"}`;

const LIMITS: Record<string, [number, Window]> = {
  create: [10, "1 h"],
  join: [40, "10 m"],
  action: [150, "1 m"],
  film: [60, "1 m"],
};

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = URL && TOKEN ? new Redis({ url: URL, token: TOKEN }) : null;
const limiters = new Map<string, Ratelimit>();

export async function allowed(name: keyof typeof LIMITS & string, key: string): Promise<boolean> {
  // Fails closed in production: an unprotected endpoint is worse than a brief outage.
  if (!redis) return process.env.NODE_ENV !== "production";
  let limiter = limiters.get(name);
  if (!limiter) {
    const [count, window] = LIMITS[name];
    limiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(count, window), prefix: `filmclub:${name}` });
    limiters.set(name, limiter);
  }
  try {
    return (await limiter.limit(key)).success;
  } catch {
    return false;
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}
