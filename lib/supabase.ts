import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder";

// NOTE: not yet typed with `createClient<Database>(...)` from `@/types/database`.
// Adopting the typed client surfaces ~5+ latent mismatches (ShortlistRound.phase
// string-vs-enum, created_at nullability gap, telemetry payload Json vs
// Record<string, unknown>, etc.) that need careful resolution. See follow-up
// issue for the migration plan. `types/database.ts` is the seed artifact.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
