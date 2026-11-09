import "server-only";
import { admin } from "@/lib/admin";

// [hits allowed, window in seconds]
const LIMITS: Record<string, [number, number]> = {
  create: [10, 3600],
  join: [40, 600],
  action: [150, 60],
  film: [120, 60],
};

// Creating sessions costs money, so it is refused when the counter can't be reached.
// Everything else carries on, so a slow database doesn't also block people mid-game.
const FAIL_CLOSED = new Set(["create"]);

export async function allowed(name: keyof typeof LIMITS & string, key: string): Promise<boolean> {
  if (process.env.NODE_ENV !== "production") return true; // local runs and tests create sessions freely
  const [limit, seconds] = LIMITS[name];
  const { data, error } = await admin().rpc("rate_limit", { p_name: name, p_key: key, p_limit: limit, p_window_seconds: seconds });
  if (error) return !FAIL_CLOSED.has(name);
  return data === true;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}
