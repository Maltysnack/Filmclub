"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { pickMysteryName } from "@/lib/names";
import { joinSession, setParticipantId } from "@/lib/session";
import Logo from "@/components/Logo";

interface KickedScreenProps {
  sessionCode: string;
  sessionId: string;
  takenNames: string[];
}

export default function KickedScreen({ sessionCode, sessionId, takenNames }: KickedScreenProps) {
  const router = useRouter();
  const [rejoining, setRejoining] = useState(false);

  async function handleRejoin() {
    setRejoining(true);
    sessionStorage.removeItem(`filmclub_participant_${sessionCode}`);
    const name = pickMysteryName(takenNames);
    const participant = await joinSession(sessionId, name);
    if (!participant) { setRejoining(false); return; }
    setParticipantId(sessionCode, participant.id);
    // Hard navigation — router.push on the same route doesn't remount the component,
    // leaving the spinner stuck. window.location resets all state cleanly.
    window.location.href = `/session/${sessionCode}`;
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6" style={{ background: "var(--bg)" }}>
      <div className="mb-8">
        <Logo size="sm" showText />
      </div>
      <p className="text-lg font-semibold mb-2" style={{ color: "var(--text)" }}>You've been removed</p>
      <p className="text-sm mb-8 text-center" style={{ color: "var(--text-muted)" }}>
        The host has removed you from this session.
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={handleRejoin}
          disabled={rejoining}
          className="w-full py-3 rounded-xl text-sm font-semibold"
          style={{ background: "var(--accent)", color: "#0c0c0e", opacity: rejoining ? 0.6 : 1 }}>
          {rejoining ? "Rejoining…" : "Rejoin with a new name"}
        </button>
        <button
          onClick={() => router.push("/")}
          className="w-full py-3 rounded-xl text-sm font-medium"
          style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
          Go home
        </button>
      </div>
    </div>
  );
}
