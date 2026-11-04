const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TMDB_API_KEY",
  "OMDB_API_KEY",
  "CRON_SECRET",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];

export function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;
  const missing = REQUIRED.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing required settings: ${missing.join(", ")}`);
}
