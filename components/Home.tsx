"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { room } from "@/lib/supabase";
import Logo from "./Logo";
import { posterUrl } from "@/lib/images";
import { logoUrl, SERVICES } from "@/lib/services";

type Step = "home" | "services" | "join";

export default function Home({ posters }: { posters: string[] }) {
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
          <div className="mb-3 flex items-center justify-between">
            <button className="label h-9" onClick={() => setStep("home")}>Back</button>
            <button aria-label="Filmclub home" onClick={() => setStep("home")}><Logo /></button>
          </div>
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
    <main className="screen flex h-dvh items-center justify-center">
      {posters.length > 0 && (
        <div aria-hidden="true" className="absolute inset-0">
          <div className="poster-wall grid grid-cols-3 gap-px sm:grid-cols-4 lg:grid-cols-7">
            {[...posters, ...posters].map((path, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={posterUrl(path, "w342")} alt="" className="aspect-[2/3] w-full object-cover" />
            ))}
          </div>
          <div className="absolute inset-0 bg-black/70" />
        </div>
      )}
      <div className="relative z-10 flex w-full max-w-[420px] flex-col gap-3 px-6">
        <h1 className="flex justify-center"><Logo size="lg" /></h1>
        <p className="label mb-4 text-center">Swipe together. Pick one film.</p>
        {step === "join" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              go(() => room("join", { code }));
            }}
          >
            <label className="label text-center" htmlFor="code">Enter your code</label>
            <input
              id="code"
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              className="display h-20 w-full border border-text bg-black text-center text-[44px] tracking-[0.2em] outline-none"
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
      </div>
      <div className="absolute bottom-3 right-4 z-10 flex">
        {process.env.NEXT_PUBLIC_GITHUB_URL && (
          <a href={process.env.NEXT_PUBLIC_GITHUB_URL} target="_blank" rel="noopener noreferrer" className="label p-2 text-[10px] text-muted">GitHub</a>
        )}
        <Link href="/credits" className="label p-2 text-[10px] text-muted">Credits</Link>
      </div>
    </main>
  );
}
