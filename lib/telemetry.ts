import { supabase } from "./supabase";
import type { Json } from "@/types/database";

// Fire-and-forget structured event logger. Writes to public.session_events so a
// developer can read real session traces with SQL instead of asking the user to
// copy-paste the browser console.
//
// Designed to be cheap: no awaits in the caller, swallows all errors, no retry.
// One swipe produces ~3 rows (handleSwipe entry + recordSwipe + post-state),
// so a 100-swipe session writes ~300 rows. Cleanup rides the existing
// cleanup-sessions cron via ON DELETE CASCADE on session_id.

type EventRow = {
  session_id: string;
  participant_id: string | null;
  event: string;
  payload: Json | null;
};

const buffer: EventRow[] = [];

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 250);
}

async function flush() {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    await supabase.from("session_events").insert(batch);
  } catch {
    // Swallow — telemetry must never break the app.
  }
}

// Flush remaining events when the tab is hidden or closed. visibilitychange
// fires reliably on mobile; pagehide is the iOS-Safari-safe fallback.
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flush();
  });
  window.addEventListener("pagehide", flush);
}

export function logEvent(
  sessionId: string | null | undefined,
  participantId: string | null | undefined,
  event: string,
  payload?: Record<string, unknown>,
) {
  if (!sessionId) return;
  buffer.push({
    session_id: sessionId,
    participant_id: participantId ?? null,
    event,
    // Callers pass arbitrary structured payloads — coerce to Json. The Json
    // type's recursive constraint is stricter than Record<string, unknown>
    // even though every concrete payload satisfies it in practice.
    payload: (payload ?? null) as Json | null,
  });
  scheduleFlush();
}
