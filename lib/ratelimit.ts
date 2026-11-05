import "server-only";
import { admin } from "@/lib/admin";

// [hits allowed, window in seconds]
const LIMITS: Record<string, [number, number]> = {
  create: [10, 3600],
  join: [40, 600],
  action: [150, 60],
  film: [60, 60],
};

// Fails closed: if the counter cannot be reached, the request is refused.
export async function allowed(name: keyof typeof LIMITS & string, key: string): Promise<boolean> {
  const [limit, seconds] = LIMITS[name];
  const { data, error } = await admin().rpc("rate_limit", { p_name: name, p_key: key, p_limit: limit, p_window_seconds: seconds });
  return !error && data === true;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}
