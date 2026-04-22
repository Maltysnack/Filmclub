"use client";

import { useState, useEffect, useRef } from "react";
import { X, ChevronRight } from "lucide-react";

// Camera logo SVG (matches Logo.tsx, inlined so we avoid the router dependency)
function CameraIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="14" width="40" height="26" rx="3" fill="#1c1c20" stroke="#e8b86d" strokeWidth="1.5"/>
      <rect x="14" y="8" width="16" height="7" rx="2" fill="#1c1c20" stroke="#e8b86d" strokeWidth="1.5"/>
      <circle cx="22" cy="27" r="9" fill="#0c0c0e" stroke="#e8b86d" strokeWidth="1.5"/>
      <circle cx="22" cy="27" r="5.5" fill="#141416" stroke="#e8b86d" strokeWidth="1"/>
      <circle cx="20" cy="25" r="1.5" fill="#e8b86d" opacity="0.4"/>
      <line x1="34" y1="18" x2="34" y2="36" stroke="#e8b86d" strokeWidth="1" opacity="0.5"/>
      <line x1="37" y1="18" x2="37" y2="36" stroke="#e8b86d" strokeWidth="1" opacity="0.5"/>
      <line x1="40" y1="18" x2="40" y2="36" stroke="#e8b86d" strokeWidth="1" opacity="0.5"/>
      <circle cx="38" cy="12" r="3" fill="#e8b86d" opacity="0.8"/>
      <path d="M4 38 Q8 44 14 42 Q18 40 22 43 Q26 46 30 42 Q36 38 44 40" stroke="#e8b86d" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.55"/>
    </svg>
  );
}

// ── Changelog (hidden for now, re-enable when needed) ─────────────────────────
// const CHANGELOG = [
//   { version: "0.4", date: "Mar 2026", notes: ["Regions worldwide", "Streaming services per region", "Feedback panel"] },
//   { version: "0.3", date: "Mar 2026", notes: ["Shortlist mode", "Nominate, veto, vote", "Host can remove members"] },
//   { version: "0.2", date: "Feb 2026", notes: ["Real-time sync", "Streaming service filter", "Match reveal screen"] },
//   { version: "0.1", date: "Jan 2026", notes: ["Create a club, share a code, swipe together"] },
// ];

const TAGS = [
  { value: "feature", label: "Feature request" },
  { value: "bug",     label: "Bug report"       },
] as const;
type Tag = typeof TAGS[number]["value"] | "other";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function InfoPanel({ open, onClose }: Props) {
  const [tag, setTag]               = useState<Tag>("feature");
  const [otherLabel, setOtherLabel] = useState("Other");
  const [message, setMsg]           = useState("");
  const [email, setEmail]           = useState("");
  const [sending, setSend]          = useState(false);
  const [sent, setSent]             = useState(false);
  const [err, setErr]               = useState<string | null>(null);
  const otherInputRef               = useRef<HTMLInputElement>(null);

  // Reset form when re-opened
  useEffect(() => {
    if (open) { setMsg(""); setEmail(""); setSent(false); setErr(null); setTag("feature"); setOtherLabel("Other"); }
  }, [open]);

  // Trap scroll
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  async function handleSend() {
    if (!message.trim()) return;
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return setErr("That email doesn't look right.");
    }
    setSend(true); setErr(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, otherLabel: tag === "other" ? otherLabel : undefined, message, email }),
      });
      if (!res.ok) throw new Error("Failed");
      setSent(true);
    } catch {
      setErr("Something went wrong, try again.");
    } finally {
      setSend(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "var(--bg)" }}
    >
      {/* Close button — inside the same max-width column as the content */}
      <div className="mx-auto w-full flex justify-end px-5" style={{ maxWidth: 480, paddingTop: "50px" }}>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-9 h-9 rounded-full transition-all hover:brightness-125"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Centred content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm flex flex-col gap-8">

          {sent ? (
            <div className="flex flex-col items-center gap-5 text-center">
              <CameraIcon />
              <p className="text-lg font-light tracking-wide" style={{ color: "var(--text)" }}>Message sent</p>
            </div>
          ) : (
            <>
              {/* Heading */}
              <div>
                <h2 className="text-2xl font-light tracking-wide mb-1" style={{ color: "var(--text)" }}>
                  Send me a message
                </h2>
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  feedback, bugs and ideas
                </p>
              </div>

              {/* Tag selector */}
              <div className="flex gap-2 flex-wrap items-center">
                {TAGS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setTag(value)}
                    className="px-4 py-2 rounded-full text-sm font-medium border transition-all"
                    style={{
                      background:  tag === value ? "var(--accent)" : "var(--surface)",
                      borderColor: tag === value ? "var(--accent)" : "var(--border)",
                      color:       tag === value ? "#0c0c0e"       : "var(--text-muted)",
                    }}
                  >
                    {label}
                  </button>
                ))}

                {/* Other — editable pill */}
                {tag === "other" ? (
                  <input
                    ref={otherInputRef}
                    value={otherLabel}
                    placeholder="Other"
                    onChange={(e) => setOtherLabel(e.target.value)}
                    onBlur={() => { if (!otherLabel.trim()) setOtherLabel("Other"); }}
                    className="px-4 py-2 rounded-full text-sm font-medium border outline-none transition-all"
                    style={{
                      background: "var(--accent)",
                      borderColor: "var(--accent)",
                      color: "#0c0c0e",
                      minWidth: "8rem",
                      width: `${Math.max((otherLabel || "Other").length + 4, 8)}ch`,
                    }}
                  />
                ) : (
                  <button
                    onClick={() => {
                      setTag("other");
                      setTimeout(() => { otherInputRef.current?.select(); setOtherLabel(""); }, 30);
                    }}
                    className="px-4 py-2 rounded-full text-sm font-medium border transition-all"
                    style={{
                      background: "var(--surface)",
                      borderColor: "var(--border)",
                      color: "var(--text-muted)",
                    }}
                  >
                    Other
                  </button>
                )}
              </div>

              {/* Message */}
              <textarea
                rows={5}
                placeholder="What's on your mind?"
                value={message}
                onChange={(e) => setMsg(e.target.value)}
                className="w-full rounded-2xl p-4 text-sm resize-none outline-none transition-all"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              />

              {/* Optional email */}
              <input
                type="email"
                placeholder="Your email (optional, for a reply)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-2xl px-4 py-3 text-sm outline-none"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              />

              {err && <p className="text-xs" style={{ color: "var(--dislike)" }}>{err}</p>}

              <button
                onClick={handleSend}
                disabled={!message.trim() || sending}
                className="w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity"
                style={{
                  background: !message.trim() || sending ? "var(--surface)" : "var(--accent)",
                  color:      !message.trim() || sending ? "var(--text-muted)" : "#0c0c0e",
                  opacity:    sending ? 0.6 : 1,
                }}
              >
                {sending ? "Sending..." : <><span>Send</span><ChevronRight size={16} /></>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
