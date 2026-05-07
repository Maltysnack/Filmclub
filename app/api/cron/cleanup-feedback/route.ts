import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Daily retention cleanup for the feedback table (issue #54).
// Deletes any feedback row older than RETENTION_DAYS. The maintainer has
// already received the email via Resend at submission time, so the DB row
// is just a backup/audit record — no need to keep it indefinitely.
//
// 90 days is generous enough to support follow-up if a feature request or
// bug report needs revisiting, while bounding the PII footprint.

const RETENTION_DAYS = 90;

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
    .from("feedback")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);

  if (error) {
    console.error("[cleanup-feedback] error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: count, cutoff });
}
