import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://placeholder.supabase.co";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "placeholder";

// Generic Database parameter type-checks every from(...) query against the
// schema in types/database.ts. Regenerate that file after schema changes via
// the Supabase MCP `generate_typescript_types` or the CLI command in its header.
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);
