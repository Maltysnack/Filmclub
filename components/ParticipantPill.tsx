"use client";

import { Film as FilmIcon } from "lucide-react";
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

  if (onFilmClick) {
    return (
      <span
        className={`inline-flex items-center rounded-md text-xs font-medium ${pad} gap-1`}
        style={{ background: `${color}22`, border: `1px solid ${color}55`, color }}
      >
        <button type="button" onClick={onClick} style={{ cursor: onClick ? "pointer" : "default" }}>
          {name}{isMe ? " (you)" : ""}
        </button>
        <button
          type="button"
          onClick={onFilmClick}
          className="opacity-40 hover:opacity-90 active:opacity-90 transition-opacity"
          style={{ cursor: "pointer", lineHeight: 0 }}
        >
          <FilmIcon size={size === "sm" ? 9 : 10} />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs ${pad} rounded-md font-medium`}
      style={{
        background: `${color}22`,
        color,
        border: `1px solid ${color}55`,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {name}{isMe ? " (you)" : ""}
    </button>
  );
}
