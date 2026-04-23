"use client";

import { participantColor } from "@/lib/names";

interface ParticipantPillProps {
  name: string;
  isMe?: boolean;
  onClick?: () => void;
  /** "sm" for compact card contexts; defaults to standard header/results sizing */
  size?: "sm" | "md";
}

export default function ParticipantPill({ name, isMe, onClick, size = "md" }: ParticipantPillProps) {
  const color = participantColor(name);
  const padding = size === "sm" ? "px-2 py-0.5" : "px-2.5 py-1";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs ${padding} rounded-md font-medium`}
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
