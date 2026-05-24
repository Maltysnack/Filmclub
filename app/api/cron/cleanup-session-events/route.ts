import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily retention cleanup for session_events (issue #107).
// session_events has session_id FK ON DELETE CASCADE, so cleanup-sessions already
// removes events for sessions older than 3 days. The gap: events with
// session_id IS NULL (telemetry emitted before a session loaded, e.g. early
// deck.mount on a stray URL) accumulate forever. A blanket time-based sweep
// closes that path and serves as a safety net for any orphaned rows.
//
// 14 days bounds the table size for anomaly digests (the telemetry-digest cron
// looks at the last 24h, so 14d is generous) without losing data needed for
// post-hoc investigation of a recent bug.

const RETENTION_DAYS = 14;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("session_events")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);

  if (error) {
    console.error("[cleanup-session-events] error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: count, cutoff });
}
