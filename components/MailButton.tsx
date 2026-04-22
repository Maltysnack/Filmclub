"use client";

import { useState } from "react";
import { Mail } from "lucide-react";
import InfoPanel from "./InfoPanel";

// Persistent mail/feedback button — rendered in the root layout so it appears
// in exactly the same position on every page. Uses CSS max() to keep it inside
// the app's 480px content column on wide screens while falling back to 1rem
// from the viewport edge on narrow ones.
export default function MailButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed z-40 flex items-center justify-center w-9 h-9 rounded-full transition-all hover:brightness-125"
        style={{
          top: "50px",
          right: "max(1rem, calc(50% - 240px + 1rem))",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          color: "var(--text-muted)",
        }}
        aria-label="Send feedback"
      >
        <Mail size={15} />
      </button>
      <InfoPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}
