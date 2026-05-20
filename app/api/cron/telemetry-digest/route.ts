import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

// Anomaly digest. Runs daily. Queries the last 24h of session_events for
// patterns that indicate a bug or weird behaviour, emails a brief summary if
// any fire, stays silent otherwise. Goal: catch regressions without the user
// having to copy-paste anything; the user forwards interesting digests on for
// a SQL deep-dive.
//
// Anomaly checks:
//  - swipe.debounced > 0           — stray clicks blocked, could indicate the
//                                    swipe-button race still happens
//  - queue.front_card_changed > 0  — the buffer was meant to silence this; any
//                                    occurrence is a regression suspect
//  - queue.front_card_replaced > 0 — front card changed without index advance
//  - realtime.channel_status != SUBSCRIBED — drops/errors during a live session
//  - participant.spoofed_kick_rejected > 0 — someone tried to forge a kick
//  - missed-match: a match.detected with no session.update_received on the
//    same device within 5 s of it — the HAZE-78 pattern

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: events, error } = await supabase
    .from("session_events")
    .select("session_id, participant_id, event, payload, created_at")
    .gte("created_at", since)
    .in("event", [
      "swipe.debounced",
      "queue.front_card_changed",
      "queue.front_card_replaced",
      "realtime.channel_status",
      "participant.spoofed_kick_rejected",
      "match.detected",
      "session.update_received",
    ])
    .order("created_at");

  if (error) {
    console.error("[telemetry-digest] query failed", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  type Event = {
    session_id: string;
    participant_id: string | null;
    event: string;
    payload: Record<string, unknown> | null;
    created_at: string;
  };
  const rows = (events ?? []) as Event[];

  // Bucket per (session_id, event) for the simple counts.
  type SessionAnomalies = {
    debounced: number;
    front_card_changed: number;
    front_card_replaced: number;
    channel_drops: number;
    spoofed_kicks: number;
    missed_matches: number;
  };
  const perSession = new Map<string, SessionAnomalies>();
  const bump = (sid: string, key: keyof SessionAnomalies) => {
    const cur = perSession.get(sid) ?? {
      debounced: 0, front_card_changed: 0, front_card_replaced: 0,
      channel_drops: 0, spoofed_kicks: 0, missed_matches: 0,
    };
    cur[key]++;
    perSession.set(sid, cur);
  };

  // Missed-match detection: pair each match.detected with the nearest
  // session.update_received from the same participant within 5 s. If none, flag.
  type StampedEvent = { participant_id: string | null; ts: number };
  const matchesBySession = new Map<string, StampedEvent[]>();
  const updatesBySession = new Map<string, StampedEvent[]>();
  for (const e of rows) {
    const ts = new Date(e.created_at).getTime();
    if (e.event === "match.detected") {
      const arr = matchesBySession.get(e.session_id) ?? [];
      arr.push({ participant_id: e.participant_id, ts });
      matchesBySession.set(e.session_id, arr);
    } else if (e.event === "session.update_received" && (e.payload as { status?: string } | null)?.status === "closed") {
      const arr = updatesBySession.get(e.session_id) ?? [];
      arr.push({ participant_id: e.participant_id, ts });
      updatesBySession.set(e.session_id, arr);
    } else if (e.event === "swipe.debounced") {
      bump(e.session_id, "debounced");
    } else if (e.event === "queue.front_card_changed") {
      bump(e.session_id, "front_card_changed");
    } else if (e.event === "queue.front_card_replaced") {
      bump(e.session_id, "front_card_replaced");
    } else if (e.event === "realtime.channel_status") {
      const status = (e.payload as { status?: string } | null)?.status;
      if (status && status !== "SUBSCRIBED") bump(e.session_id, "channel_drops");
    } else if (e.event === "participant.spoofed_kick_rejected") {
      bump(e.session_id, "spoofed_kicks");
    }
  }

  // For each session with matches, check if every other participant in the
  // session got a closed-status update within 5 s. We can't see participants
  // who never logged anything; this catches the common case.
  for (const [sid, matches] of matchesBySession) {
    const updates = updatesBySession.get(sid) ?? [];
    const updateTimesByPid = new Map<string | null, number[]>();
    for (const u of updates) {
      const arr = updateTimesByPid.get(u.participant_id) ?? [];
      arr.push(u.ts);
      updateTimesByPid.set(u.participant_id, arr);
    }
    // Build the set of participant ids that emitted anything in this session.
    const participantsInSession = new Set<string>();
    for (const e of rows) {
      if (e.session_id === sid && e.participant_id) participantsInSession.add(e.participant_id);
    }
    // For each participant, find the latest match in the session and check
    // they got an update within 5 s of it. If not, that's a missed match for them.
    const latestMatchTs = Math.max(...matches.map(m => m.ts));
    for (const pid of participantsInSession) {
      const updateTimes = updateTimesByPid.get(pid) ?? [];
      const gotUpdate = updateTimes.some(t => Math.abs(t - latestMatchTs) <= 5000);
      if (!gotUpdate) bump(sid, "missed_matches");
    }
  }

  // Build report
  const sessionEntries = [...perSession.entries()]
    .filter(([, a]) => a.debounced || a.front_card_changed || a.front_card_replaced || a.channel_drops || a.spoofed_kicks || a.missed_matches);

  if (sessionEntries.length === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: "no anomalies" });
  }

  // Look up session codes for the affected ids
  const sessionIds = sessionEntries.map(([sid]) => sid);
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, code")
    .in("id", sessionIds);
  const codeById = new Map((sessions ?? []).map(s => [s.id, s.code]));

  const rowsHtml = sessionEntries.map(([sid, a]) => {
    const code = codeById.get(sid) ?? sid.slice(0, 8);
    const flags: string[] = [];
    if (a.missed_matches) flags.push(`<b>${a.missed_matches}× missed-match</b>`);
    if (a.spoofed_kicks) flags.push(`<b>${a.spoofed_kicks}× spoofed-kick</b>`);
    if (a.front_card_changed) flags.push(`${a.front_card_changed}× front-card-changed`);
    if (a.front_card_replaced) flags.push(`${a.front_card_replaced}× front-card-replaced`);
    if (a.debounced) flags.push(`${a.debounced}× debounced`);
    if (a.channel_drops) flags.push(`${a.channel_drops}× channel-drop`);
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;font-weight:600;color:#111">${code}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:#555">${flags.join(" · ")}</td>
    </tr>`;
  }).join("");

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px 24px;background:#ffffff">
      <h2 style="margin:0 0 4px;font-size:18px;font-weight:700;color:#111">Telemetry anomalies — last 24h</h2>
      <p style="margin:0 0 24px;font-size:13px;color:#999">${sessionEntries.length} session${sessionEntries.length === 1 ? "" : "s"} with flagged events</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead>
          <tr style="background:#f8f8f8">
            <th style="padding:8px 12px;text-align:left;color:#999;font-weight:500">Session</th>
            <th style="padding:8px 12px;text-align:left;color:#999;font-weight:500">Anomalies</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="margin:24px 0 0;font-size:11px;color:#ccc">Forward to Claude with the session code to dig in.</p>
    </div>
  `;

  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: "Filmclub <feedback@filmclub.watch>",
    to: "owner@example.com",
    subject: `Filmclub telemetry — ${sessionEntries.length} flagged session${sessionEntries.length === 1 ? "" : "s"}`,
    html,
  });

  return NextResponse.json({ ok: true, sent: true, sessions: sessionEntries.length });
}
