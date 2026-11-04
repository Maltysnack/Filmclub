"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { room } from "@/lib/supabase";
import { posterUrl } from "@/lib/images";
import { logoUrl, SERVICES } from "@/lib/services";

type Step = "home" | "services" | "join";

export default function Home({ poster }: { poster: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("home");
  const [chosen, setChosen] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go(run: () => Promise<{ code: string }>) {
    setBusy(true);
    setError(null);
    try {
      router.push(`/session/${(await run()).code}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (step === "services") {
    return (
      <main className="column flex h-dvh flex-col pt-14">
        <div className="px-6 pb-6">
          <button className="label mb-3 h-7" onClick={() => setStep("home")}>Back</button>
          <h1 className="display text-[38px]">What have<br />you got?</h1>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-px overflow-y-auto border-y border-line bg-line">
          {SERVICES.map((service) => {
            const on = chosen.includes(service.id);
            return (
              <button
                key={service.id}
                aria-label={service.name}
                aria-pressed={on}
                onClick={() => setChosen(on ? chosen.filter((s) => s !== service.id) : [...chosen, service.id])}
                className="relative flex min-h-24 items-center justify-center bg-bg"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoUrl(service.logo)} alt="" className={`size-[76px] ${on ? "" : "opacity-45"}`} />
                {on && <span className="pointer-events-none absolute inset-0 border-[3px] border-text" />}
              </button>
            );
          })}
        </div>
        <div className="px-6 pb-8 pt-4">
          {error && <p role="alert" className="label mb-3 text-[var(--red-text)]">{error}</p>}
          <button className="slab" disabled={busy || chosen.length === 0} onClick={() => go(() => room("create", { services: chosen }))}>
            {busy ? "Setting up" : "Continue"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="screen flex flex-col lg:flex-row">
      <div className="relative min-h-0 flex-1 lg:h-dvh">
        {poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={posterUrl(poster)} alt="" className="absolute inset-0 size-full object-cover" />
        )}
        <span className="pointer-events-none absolute inset-3 border border-text" />
        <span className="absolute right-6 top-6 size-3.5 bg-red" />
      </div>
      <div className="flex shrink-0 flex-col gap-3 bg-bg px-6 pb-7 pt-5 lg:h-dvh lg:w-[520px] lg:justify-center lg:px-16">
        <h1 className="display text-[46px] sm:text-[54px] lg:text-[64px]">Filmclub</h1>
        <p className="label mb-2">Swipe together. Pick one film.</p>
        {step === "join" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              go(() => room("join", { code }));
            }}
          >
            <label className="label" htmlFor="code">Enter your code</label>
            <input
              id="code"
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              className="display h-20 w-full border border-text bg-bg text-center text-[44px] tracking-[0.2em] outline-none"
            />
            {error && <p role="alert" className="label text-[var(--red-text)]">{error}</p>}
            <button className="slab" disabled={busy || code.length !== 4}>{busy ? "Joining" : "Join"}</button>
            <button type="button" className="slab slab-outline !h-14 !text-[17px]" onClick={() => setStep("home")}>Back</button>
          </form>
        ) : (
          <>
            <button className="slab" onClick={() => setStep("services")}>Start</button>
            <button className="slab slab-outline !h-14 !text-[17px]" onClick={() => setStep("join")}>Join with code</button>
          </>
        )}
        <div className="mt-3 flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/tmdb.svg" alt="TMDB" className="mt-0.5 h-2.5 w-auto" />
          <p className="text-[10px] leading-relaxed text-muted">
            This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming data from JustWatch.
          </p>
        </div>
      </div>
    </main>
  );
}
