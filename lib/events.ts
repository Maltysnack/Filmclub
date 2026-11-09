import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { after } from "next/server";
import { admin } from "@/lib/admin";

export interface SessionEvent {
  kind: string;
  session_id?: string | null;
  code?: string | null;
  game?: number | null;
  user_id?: string | null;
  ms?: number | null;
  ok?: boolean;
  detail?: Record<string, unknown>;
}

const pending = new AsyncLocalStorage<SessionEvent[]>();

// Adds to this request's timeline. Written after the response, so it never slows anyone down.
export function record(event: SessionEvent) {
  pending.getStore()?.push(event);
}

export function withEvents<T>(run: () => Promise<T>): Promise<T> {
  const events: SessionEvent[] = [];
  return pending.run(events, async () => {
    try {
      return await run();
    } finally {
      after(async () => {
        if (events.length === 0) return;
        const { error } = await admin().from("session_events").insert(events);
        if (error) console.error("session events not saved", error.message);
      });
    }
  });
}
