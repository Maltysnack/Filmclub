"use client";

import { Copy, Check } from "lucide-react";

// ── Shared visual constants ────────────────────────────────────────────────────
// Font is text-[44px] leading-none so characters match the service tile height.
// The shell adds visible padding around that text so the box is a bit bigger.
// Change these constants and both the lobby display and join-page input update.

const SHELL = "px-6 py-2 rounded-2xl";
const TEXT  = "font-mono font-bold text-[44px] leading-none tracking-widest";
const BOX_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
} as const;

// ── Lobby code box — clickable button that copies the join link ───────────────

interface CodeDisplayProps {
  code: string;
  onClick: () => void;
  copied: boolean;
}

export function CodeDisplay({ code, onClick, copied }: CodeDisplayProps) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-4 ${SHELL} transition-all`}
      style={BOX_STYLE}
    >
      <span className={TEXT} style={{ color: "var(--accent)" }}>{code}</span>
      {copied
        ? <Check size={22} style={{ color: "var(--like)" }} />
        : <Copy size={22} style={{ color: "var(--text-muted)" }} />}
    </button>
  );
}

// ── Join-page code input — same shell, editable ───────────────────────────────

interface CodeInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
  maxLength?: number;
}

export function CodeInput({
  value,
  onChange,
  placeholder = "WOLF-42",
  autoFocus,
  maxLength = 7,
}: CodeInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      autoFocus={autoFocus}
      maxLength={maxLength}
      className={`${TEXT} text-center outline-none placeholder:opacity-25 ${SHELL}`}
      style={{ ...BOX_STYLE, color: "var(--accent)", width: "auto", minWidth: "12rem" }}
    />
  );
}
