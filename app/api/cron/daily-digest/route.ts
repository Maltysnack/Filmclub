import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since = yesterday.toISOString();

  // Sessions created in the last 24 hours
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, code, mode, region, streaming_services, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (!sessions || sessions.length === 0) {
    // No activity — skip the email
    return NextResponse.json({ ok: true, sent: false, reason: "no activity" });
  }

  const sessionIds = sessions.map((s) => s.id);

  // Participants, swipes, matches and outcomes for those sessions
  const [
    { data: participants },
    { data: outcomes },
    { count: swipeCount },
    { count: matchCount },
  ] = await Promise.all([
    supabase.from("participants").select("session_id, name").in("session_id", sessionIds),
    supabase.from("session_outcomes").select("film_title, group_size, region, service_ids").in("session_id", sessionIds),
    supabase.from("swipes").select("*", { count: "exact", head: true }).in("session_id", sessionIds),
    supabase.from("matches").select("*", { count: "exact", head: true }).in("session_id", sessionIds),
  ]);

  const totalParticipants = participants?.length ?? 0;
  const realSessions = sessions.filter((s) => {
    const count = participants?.filter((p) => p.session_id === s.id).length ?? 0;
    return count >= 2;
  });

  // Build HTML rows for each session
  const sessionRows = sessions.map((s) => {
    const pax = participants?.filter((p) => p.session_id === s.id) ?? [];
    const outcome = outcomes?.find((o) => o);
    const winner = outcomes?.find((_, i) => sessionIds.indexOf(s.id) === i);
    const names = pax.map((p) => p.name).join(", ") || "—";
    const services = (s.streaming_services as string[] | null)?.join(", ") || "Any";
    const time = new Date(s.created_at).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", timeZone: "Australia/Sydney" });
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-weight:600;color:#111">${s.code}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#555">${time} AEST</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#555">${pax.length}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#555">${names}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#555">${services}</td>
      </tr>`;
  }).join("");

  const winnerRows = outcomes && outcomes.length > 0
    ? outcomes.map((o) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-weight:600;color:#111">${o.film_title}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#555">${o.group_size} people</td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#555">${o.region ?? "—"}</td>
      </tr>`).join("")
    : `<tr><td colspan="3" style="padding:8px 12px;color:#999">No completed sessions yet</td></tr>`;

  const dateLabel = yesterday.toLocaleDateString("en-AU", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Australia/Sydney",
  });

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 24px;background:#ffffff">
      <img src="https://filmclub.watch/logo.png" width="36" height="36" alt="Filmclub" style="display:block;margin-bottom:16px" />
      <h2 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#111">Daily digest</h2>
      <p style="margin:0 0 32px;font-size:14px;color:#999">${dateLabel}</p>

      <div style="display:flex;gap:24px;margin-bottom:32px">
        ${stat(sessions.length, "sessions")}
        ${stat(realSessions.length, "with 2+ people")}
        ${stat(totalParticipants, "participants")}
        ${stat(swipeCount ?? 0, "swipes")}
        ${stat(outcomes?.length ?? 0, "winners picked")}
      </div>

      <h3 style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#999;margin:0 0 8px">Sessions</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:32px">
        <thead>
          <tr style="background:#f8f8f8">
            <th style="padding:8px 12px;text-align:left;color:#999;font-weight:500">Code</th>
            <th style="padding:8px 12px;text-align:left;color:#999;font-weight:500">Time</th>
            <th style="padding:8px 12px;text-align:left;color:#999;font-weight:500">People</th>
            <th style="padding:8px 12px;text-align:left;color:#999;font-weight:500">Names</th>
            <th style="padding:8px 12px;text-align:left;color:#999;font-weight:500">Services</th>
          </tr>
        </thead>
        <tbody>${sessionRows}</tbody>
      </table>

      <h3 style="font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#999;margin:0 0 8px">Films picked</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:32px">
        <thead>
          <tr style="background:#f8f8f8">
            <th style="padding:8px 12px;text-align:left;color:#999;font-weight:500">Film</th>
            <th style="padding:8px 12px;text-align:left;color:#999;font-weight:500">Group size</th>
            <th style="padding:8px 12px;text-align:left;color:#999;font-weight:500">Region</th>
          </tr>
        </thead>
        <tbody>${winnerRows}</tbody>
      </table>

      <p style="color:#ccc;font-size:11px;margin:0">filmclub.watch · daily digest</p>
    </div>
  `;

  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: "Filmclub <feedback@filmclub.watch>",
    to: "owner@example.com",
    subject: `Filmclub digest — ${sessions.length} session${sessions.length === 1 ? "" : "s"} yesterday`,
    html,
  });

  return NextResponse.json({ ok: true, sent: true, sessions: sessions.length });
}

function stat(value: number, label: string) {
  return `
    <div style="flex:1;background:#f8f8f8;border-radius:10px;padding:16px;min-width:80px">
      <div style="font-size:24px;font-weight:700;color:#111;line-height:1">${value}</div>
      <div style="font-size:12px;color:#999;margin-top:4px">${label}</div>
    </div>`;
}
