"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "./Logo";
import { room } from "@/lib/supabase";

export default function LeaveLogo({ sessionId, code }: { sessionId: string; code: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function leave() {
    setLeaving(true);
    await room("leave", { sessionId }).catch(() => {});
    router.push("/");
  }

  return (
    <>
      <button aria-label="Leave and go to the home screen" onClick={() => setAsking(true)} className="absolute left-3 top-3 z-40 flex h-9 items-center bg-black px-2">
        <Logo />
      </button>
      {asking && (
        <div data-modal role="dialog" aria-modal="true" aria-label="Leave this session?" className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 px-6">
          <div className="flex w-full max-w-[420px] flex-col gap-3">
            <h2 className="display text-[38px]">Leave this session?</h2>
            <p className="mb-4 text-sm leading-relaxed">Enter {code} to come back as the same character.</p>
            <button autoFocus className="slab" onClick={() => setAsking(false)}>Stay</button>
            <button className="slab slab-outline !h-14 !text-[17px]" disabled={leaving} onClick={leave}>Leave</button>
          </div>
        </div>
      )}
    </>
  );
}
