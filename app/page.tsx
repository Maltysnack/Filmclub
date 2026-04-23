"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import DendyLogo from "@/components/DendyLogo";
import { createSession, joinSession, getSession, getParticipants, setParticipantId, setIsHost } from "@/lib/session";
import { getServicesForRegion, detectRegion, REGION_OPTIONS } from "@/lib/streaming";
import { ChevronRight, ChevronDown, Users } from "lucide-react";
import MailButton from "@/components/MailButton";
import { seedHomePool } from "@/lib/pool";
import type { WatchMode, Region } from "@/types";

type Tab = "create" | "join";

// ── helpers ───────────────────────────────────────────────────────────────────

function dateStrFromOffset(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function fmtTime(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr), m = parseInt(mStr);
  const period = h < 12 ? "am" : "pm";
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${dh}${period}` : `${dh}:${String(m).padStart(2, "0")}${period}`;
}

function formatCinema(dateStr: string, from: string, to: string): string {
  if (!dateStr || !from || !to) return "";
  const d = new Date(dateStr + "T12:00:00");
  const weekday = d.toLocaleDateString("en-AU", { weekday: "long" });
  const month   = d.toLocaleDateString("en-AU", { month: "long" });
  return `${weekday} ${ordinal(d.getDate())} ${month} ${fmtTime(from)} – ${fmtTime(to)}`;
}

import { pickMysteryName } from "@/lib/names";

// ── page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("create");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  // Create form
  // NAME_INPUT_HIDDEN: random name only — re-enable these to let users type their own name
  const [threshold] = useState(100);
  // CINEMA_HIDDEN: watchMode locked to "home" until cinema feature is re-enabled
  const watchMode: WatchMode = "home";
  const [region, setRegion] = useState<Region>("AU");
  const [regionOpen, setRegionOpen] = useState(false);

  function changeRegion(r: Region) {
    setRegion(r);
    try { localStorage.setItem("filmclub_region", r); } catch { /* ignore */ }
  }
  const [selectedServices, setSelectedServices] = useState<string[]>([]);

  // CINEMA_HIDDEN: date/time state preserved for when cinema is re-enabled
  // const [cinemaDateStr, setCinemaDateStr] = useState(() => dateStrFromOffset(0));
  // const [cinemaFromTime, setCinemaFromTime] = useState("18:00");
  // const [cinemaToTime, setCinemaToTime] = useState("20:00");

  // Restore saved region, or auto-detect on first ever visit
  useEffect(() => {
    try {
      const saved = localStorage.getItem("filmclub_region") as Region | null;
      if (saved) { setRegion(saved); return; }
    } catch { /* ignore */ }
    setRegion(detectRegion());
  }, []);

  // Derive the service list for the currently selected region
  const regionServices = getServicesForRegion(region);

  // Preload every logo across all regions once on mount — switching region is then instant
  useEffect(() => {
    (["AU", "US", "GB"] as Region[]).forEach((r) => {
      getServicesForRegion(r).forEach((svc) => {
        if (svc.tmdbLogoPath) {
          const img = new window.Image();
          img.src = `https://image.tmdb.org/t/p/w45${svc.tmdbLogoPath}`;
        }
      });
    });
  }, []);

  // Clear selected services when region changes (service IDs differ per region)
  useEffect(() => {
    setSelectedServices([]);
  }, [region]);

  // Join form
  const [joinCode, setJoinCode] = useState("");
  // NAME_INPUT_HIDDEN: joinName preserved for re-enable
  // const [joinName, setJoinName] = useState("");

  function handleJoinCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.toUpperCase();
    const letters = raw.replace(/[^A-Z0-9]/g, "").slice(0, 6);
    let display: string;
    if (letters.length > 4) {
      display = letters.slice(0, 4) + "-" + letters.slice(4);
    } else if (letters.length === 4 && raw.replace(/[^A-Z0-9-]/g, "").endsWith("-")) {
      display = letters + "-";
    } else {
      display = letters;
    }
    setJoinCode(display);
  }

  function resolveName(raw: string, takenNames: string[] = []): string {
    const trimmed = raw.trim();
    if (!trimmed) return pickMysteryName(takenNames);
    if (trimmed.toLowerCase() === "tom")   return "Blue Bandit";
    if (trimmed.toLowerCase() === "pop")   return "Pop ❤️";
    if (trimmed.toLowerCase() === "poppy") return "Poppy ❤️";
    return trimmed;
  }

  function normaliseCode(raw: string): string {
    return raw.trim().toUpperCase().replace(/-/g, "");
  }

  function toggleService(id: string) {
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  // Called from the confirmation modal — services are guaranteed selected by this point
  async function handleCreate() {
    setLoading(true);
    setError(null);

    const session = await createSession(
      "live",
      null,
      threshold,
      watchMode,
      selectedServices,
      null, // cinemaDateStr — CINEMA_HIDDEN
      null, // cinemaFromTime — CINEMA_HIDDEN
      null, // cinemaToTime  — CINEMA_HIDDEN
      "browse",
      region,
    );
    if (!session) {
      setLoading(false);
      setShowConfirm(false);
      return setError("Something went wrong. Try again.");
    }

    const participant = await joinSession(session.id, resolveName(""));
    if (!participant) {
      setLoading(false);
      setShowConfirm(false);
      return setError("Something went wrong. Try again.");
    }

    setParticipantId(session.code, participant.id);
    setIsHost(session.code);

    // Fire-and-forget initial seed — starts fetching films immediately so they
    // land in the DB while the lobby animation plays, hiding the loading latency.
    void seedHomePool(session);

    // Store logo position so the lobby animation can start from exactly here
    try {
      const el = document.getElementById("home-logo");
      if (el) sessionStorage.setItem("filmclub-logo-y", String(el.getBoundingClientRect().top));
    } catch { /* ignore */ }

    router.push(`/session/${session.code}`);
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return setError("Enter the code");

    setLoading(true);
    setError(null);

    const code = normaliseCode(joinCode);
    const session = await getSession(code);
    if (!session) { setLoading(false); return setError("Club not found. Check the code."); }
    if (session.status === "closed") { setLoading(false); return setError("This club has ended."); }

    const existing = await getParticipants(session.id);
    const takenNames = existing.map((p) => p.name);
    const participant = await joinSession(session.id, resolveName("", takenNames));
    if (!participant) { setLoading(false); return setError("Something went wrong. Try again."); }

    setParticipantId(session.code, participant.id);

    // Store logo position so the lobby animation can start from exactly here
    try {
      const el = document.getElementById("home-logo");
      if (el) sessionStorage.setItem("filmclub-logo-y", String(el.getBoundingClientRect().top));
    } catch { /* ignore */ }

    router.push(`/session/${session.code}`);
  }

  // CINEMA_HIDDEN: showStreaming always true, showCinema always false
  const showStreaming = true;

  return (
    <main
      className="min-h-dvh overflow-y-auto flex flex-col items-center justify-center px-5 py-12"
      style={{ background: "var(--bg)" }}>

      <MailButton />

      {/* Logo + tagline — anchored at a fixed offset from top, never moves */}
      <div className="mb-10 text-center">
        <div id="home-logo" className="flex justify-center mb-3">
          <Logo size="lg" />
        </div>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Decide on a film. Without the argument.
        </p>
      </div>

      {/* Tab toggle */}
      <div className="w-full max-w-sm mb-6">
        <div className="flex rounded-xl p-1" style={{ background: "var(--surface)" }}>
          {(["create", "join"] as Tab[]).map((t) => (
            <button key={t} onClick={() => { setTab(t); setError(null); }}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200"
              style={{
                background: tab === t ? "rgba(232,184,109,0.12)" : "transparent",
                color: tab === t ? "var(--accent)" : "var(--text-muted)",
              }}>
              {t === "create" ? "Start" : "Join"}
            </button>
          ))}
        </div>
      </div>

      {/* Fixed-height flex container — both forms are flex-1 inside it, so they
          always fill the same height and the CTA buttons land at the same Y.
          min-h-[24rem] comfortably accommodates the tallest service grid. */}
      <div className="w-full max-w-sm flex flex-col" style={{ minHeight: "13rem" }}>

        {tab === "create" && (
          <form
            onSubmit={(e) => e.preventDefault()}
            className="flex-1 flex flex-col gap-3">

            {/* CINEMA_HIDDEN: "Watching at" field removed — re-enable when cinema returns */}

            {/* Streaming services + region picker */}
            {showStreaming && (
              <div className="space-y-3">
                {/* Label row with region selector on the right */}
                <div className="flex items-start justify-between">
                  <label className="block text-xs font-medium uppercase tracking-wider"
                    style={{ color: "var(--text-muted)" }}>Choose your streaming services</label>
                  {/* Region picker */}
                  <div className="relative">
                    {(() => {
                      const current = REGION_OPTIONS.find(r => r.value === region)!;
                      return (
                        <>
                          <button type="button"
                            onClick={() => setRegionOpen(v => !v)}
                            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                            style={{
                              background: "var(--surface)",
                              border: "1px solid var(--border)",
                              color: "var(--text-muted)",
                            }}>
                            <span>{current.flag}</span>
                            <span className="tracking-wide">{current.abbrev}</span>
                            <ChevronDown size={10} style={{
                              transform: regionOpen ? "rotate(180deg)" : "none",
                              transition: "transform 0.15s",
                              flexShrink: 0,
                            }} />
                          </button>
                          {regionOpen && (
                            <div className="absolute z-50 p-1.5 rounded-xl"
                              style={{
                                bottom: "calc(100% + 6px)",
                                right: 0,
                                background: "var(--surface-2)",
                                border: "1px solid var(--border)",
                                boxShadow: "0 -8px 24px rgba(0,0,0,0.5)",
                                display: "grid",
                                gridTemplateColumns: "repeat(5, 1fr)",
                                gap: "2px",
                              }}>
                              {REGION_OPTIONS.map(({ value, flag, abbrev }) => (
                                <button key={value} type="button"
                                  onClick={() => { changeRegion(value); setRegionOpen(false); }}
                                  className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg text-xs transition-colors"
                                  style={{
                                    background: region === value ? "rgba(255,255,255,0.08)" : "transparent",
                                    color: region === value ? "var(--text)" : "var(--text-muted)",
                                  }}>
                                  <span className="text-base leading-none">{flag}</span>
                                  <span className="tracking-wide font-medium" style={{ fontSize: "10px" }}>{abbrev}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Always-open service grid — AU has 9 services (3×3), all others have 8 (4×2) */}
                <div className="grid gap-2" style={{
                  gridTemplateColumns: `repeat(${regionServices.length === 9 ? 3 : 4}, 1fr)`,
                }}>
                  {regionServices.map((svc) => {
                    const on = selectedServices.includes(svc.id);
                    return (
                      <button key={svc.id} type="button" onClick={() => toggleService(svc.id)}
                        className="relative flex items-center justify-center rounded-xl transition-all overflow-hidden"
                        style={{
                          aspectRatio: "1",
                          background: svc.color,
                          border: `2px solid ${on ? "var(--like)" : "transparent"}`,
                          boxShadow: on ? "0 0 0 2px var(--like)" : "none",
                          outline: "none",
                          opacity: on ? 1 : 0.45,
                        }}>
                        <span className="text-[9px] font-bold" style={{ color: "#fff" }}>{svc.abbrev}</span>
                        {svc.tmdbLogoPath && (
                          <img
                            src={`https://image.tmdb.org/t/p/w92${svc.tmdbLogoPath}`}
                            alt={svc.name}
                            title={svc.name}
                            className="absolute inset-0 w-full h-full object-cover"
                            onError={e => { e.currentTarget.style.display = "none"; }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* CINEMA_HIDDEN: CinemaDatePicker removed — re-enable when cinema returns */}

            {error && <p className="text-sm" style={{ color: "var(--dislike)" }}>{error}</p>}

            <div className="flex-1" />

            {selectedServices.length === 0 ? (
              /* Disabled hint — visible only until a service is selected */
              <button
                type="button"
                disabled
                className="w-full py-3.5 rounded-xl text-sm font-medium"
                style={{
                  background: "var(--surface)",
                  color: "var(--text-muted)",
                  opacity: 0.5,
                  cursor: "not-allowed",
                }}>
                Select a service to continue
              </button>
            ) : (
              /* Active — opens confirmation modal */
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                disabled={loading}
                className="w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity"
                style={{ background: "var(--accent)", color: "#0c0c0e", opacity: loading ? 0.6 : 1 }}>
                <span>Start</span><ChevronRight size={16} />
              </button>
            )}
          </form>
        )}

        {tab === "join" && (
          <form onSubmit={handleJoin} className="flex-1 flex flex-col gap-3">

            {/* Label at top — same style as streaming label */}
            <label className="block text-xs font-medium uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}>Code</label>

            {/* Code box directly under label — matches lobby code box styling */}
            <div className="flex justify-center">
              <input
                type="text"
                placeholder="WOLF-42"
                value={joinCode}
                onChange={handleJoinCodeChange}
                maxLength={7}
                autoFocus
                className="font-mono font-bold text-4xl tracking-widest text-center outline-none placeholder:opacity-25 px-7 py-5 rounded-3xl"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--accent)",
                  width: "auto",
                  minWidth: "12rem",
                }}
              />
            </div>

            {/* NAME_INPUT_HIDDEN: name field removed — random character assigned automatically
            <Field label="Your name">
              <input type="text" placeholder={namePlaceholder} value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none placeholder:opacity-30"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }} />
            </Field>
            */}

            {/* Spacer pushes button to bottom of container, matching the Start tab layout */}
            <div className="flex-1" />

            {error && <p className="text-sm text-center" style={{ color: "var(--dislike)" }}>{error}</p>}

            <button type="submit" disabled={loading}
              className="w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity"
              style={{ background: "var(--accent)", color: "#0c0c0e", opacity: loading ? 0.6 : 1 }}>
              {loading ? "Joining..." : <><Users size={16} /><span>Join</span></>}
            </button>
          </form>
        )}

      </div>

      {/* ── Start session confirmation modal ──────────────────────────────────── */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-5"
          style={{ background: "rgba(12,12,14,0.8)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl p-6 flex flex-col gap-4"
            style={{ background: "var(--surface)" }}>
            <div>
              <p className="text-sm font-semibold mb-3" style={{ color: "var(--text)" }}>
                Start session?
              </p>
              {/* Show selected service logos so users can confirm / spot omissions */}
              <div className="flex gap-2 flex-wrap">
                {selectedServices.map((id) => {
                  const svc = regionServices.find((s) => s.id === id);
                  if (!svc) return null;
                  return (
                    <div key={id}
                      className="relative w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center shrink-0"
                      style={{ background: svc.color }}>
                      <span className="text-[8px] font-bold" style={{ color: "#fff" }}>{svc.abbrev}</span>
                      {svc.tmdbLogoPath && (
                        <img
                          src={`https://image.tmdb.org/t/p/w45${svc.tmdbLogoPath}`}
                          alt={svc.name}
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={e => { e.currentTarget.style.display = "none"; }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>
                You can mix multiple services to widen the film pool.
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                Back
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity"
                style={{ background: "var(--accent)", color: "#0c0c0e", opacity: loading ? 0.6 : 1 }}>
                {loading ? "Starting…" : "Start session"}
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}

// ── sub-components ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}>{label}</label>
      {children}
    </div>
  );
}


function PickerShell({ label, summary, open, onToggle, children }: {
  label: string; summary: string; open: boolean;
  onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}>{label}</label>
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all"
        style={{
          background: "var(--surface)",
          border: `1px solid ${open ? "var(--accent)" : "var(--border)"}`,
        }}>
        <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{summary}</span>
        <ChevronDown size={14} style={{
          color: "var(--text-muted)",
          transform: open ? "rotate(180deg)" : "none",
          transition: "transform 0.2s",
          flexShrink: 0,
        }} />
      </button>
      {open && <div className="space-y-2 px-1">{children}</div>}
    </div>
  );
}

function CinemaDatePicker({ dateStr, fromTime, toTime, onDateChange, onFromChange, onToChange }: {
  dateStr: string; fromTime: string; toTime: string;
  onDateChange: (v: string) => void; onFromChange: (v: string) => void; onToChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <PickerShell label="Cinema session times" summary={formatCinema(dateStr, fromTime, toTime)}
      open={open} onToggle={() => setOpen(o => !o)}>
      <DayPicker value={dateStr} onChange={onDateChange} />
      <div className="flex items-center gap-3" style={{ maxWidth: "85%" }}>
        <input type="time" value={fromTime} onChange={e => onFromChange(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2.5 rounded-xl text-sm outline-none"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", colorScheme: "dark" }} />
        <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>–</span>
        <input type="time" value={toTime} onChange={e => onToChange(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2.5 rounded-xl text-sm outline-none"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", colorScheme: "dark" }} />
      </div>
    </PickerShell>
  );
}

function DayPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const str     = d.toISOString().slice(0, 10);
    const label   = i === 0 ? "Today" : i === 1 ? "Tomorrow"
      : d.toLocaleDateString("en-AU", { weekday: "short" });
    const dateNum = d.getDate();
    return { str, label, dateNum };
  });

  return (
    <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
      {days.map(({ str, label, dateNum }) => {
        const active = value === str;
        return (
          <button key={str} type="button" onClick={() => onChange(str)}
            className="flex-none flex flex-col items-center justify-center gap-0.5 rounded-xl border transition-all"
            style={{
              width: 64, height: 64,
              background:  active ? "var(--accent)" : "var(--surface)",
              borderColor: active ? "var(--accent)" : "var(--border)",
              color:       active ? "#0c0c0e"       : "var(--text-muted)",
            }}>
            <span className="text-[11px] font-medium">{label}</span>
            <span className="text-lg font-bold leading-none">{dateNum}</span>
          </button>
        );
      })}
    </div>
  );
}
