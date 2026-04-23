"use client";

import { participantColor } from "@/lib/names";

interface ParticipantPillProps {
  name: string;
  isMe?: boolean;
  onClick?: () => void;
}

export default function ParticipantPill({ name, isMe, onClick }: ParticipantPillProps) {
  const color = participantColor(name);
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs px-2.5 py-1 rounded-md font-medium"
      style={{
        background: `${color}22`,
        color,
        border: `1px solid ${color}55`,
        cursor: onClick ? "pointer" : "default",
      }}>
      {name}{isMe ? " (you)" : ""}
    </button>
  );
}
