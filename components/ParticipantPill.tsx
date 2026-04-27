"use client";

import { participantColor } from "@/lib/names";

interface ParticipantPillProps {
  name: string;
  isMe?: boolean;
  onClick?: () => void;
  onFilmClick?: () => void;
  size?: "sm" | "md";
}

export default function ParticipantPill({ name, isMe, onClick, onFilmClick, size = "md" }: ParticipantPillProps) {
  const color = participantColor(name);
  const pad = size === "sm" ? "px-2 py-0.5" : "px-2.5 py-1";
  const handler = onClick ?? onFilmClick;
  return (
    <button
      type="button"
      onClick={handler}
      className={`text-xs ${pad} rounded-md font-medium`}
      style={{
        background: `${color}22`,
        color,
        border: `1px solid ${color}55`,
        cursor: handler ? "pointer" : "default",
      }}
    >
      {name}{isMe ? " (you)" : ""}
    </button>
  );
}
