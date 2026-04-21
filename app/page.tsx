"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import DendyLogo from "@/components/DendyLogo";
import InfoPanel from "@/components/InfoPanel";
import { createSession, joinSession, getSession, getParticipants, setParticipantId, setIsHost } from "@/lib/session";
import { getServicesForRegion, detectRegion, REGION_OPTIONS } from "@/lib/streaming";
import { ChevronRight, ChevronDown, Users, Mail } from "lucide-react";
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

import { PLAYER_NAMES } from "@/lib/names";

// ── page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("create");
  // NAME_INPUT_HIDDEN: random name only — re-enable these to let users type their own name
  // const [namePlaceholder, setNamePlaceholder] = useState("");
  // useEffect(() => {
  //   setNamePlaceholder(`e.g. ${MYSTERY_NAMES[Math.floor(Math.random() * MYSTERY_NAMES.length)]}`);
  // }, []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // Create form
  // NAME_INPUT_HIDDEN: name state preserved for re-enable
  // const [name, setName] = useState("");
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
  const [streamingOpen, setStreamingOpen] = useState(false);

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
    setStreamingOpen(false);
  }, [region]);

  // Join form
  const [joinCode, setJoinCode] = useState("");
  // NAME_INPUT_HIDDEN: joinName preserved for re-enable
  // const [joinName, setJoinName] = useState("");


  function handleJoinCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Strip hyphens + non-alphanumeric, uppercase, cap at 6 chars
    const clean = e.target.value.replace(/-/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    // Auto-insert hyphen after 4th character once the user has typed past it
    setJoinCode(clean.length > 4 ? clean.slice(0, 4) + "-" + clean.slice(4) : clean);
  }

  function pickMysteryName(takenNames: string[]): string {
    const available = PLAYER_NAMES.filter((n) => !takenNames.includes(n));
    const pool = available.length > 0 ? available : PLAYER_NAMES;
    return pool[Math.floor(Math.random() * pool.length)];
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

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (selectedServices.length === 0)
      return setError("Select at least one streaming service");

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
    if (!session) { setLoading(false); return setError("Something went wrong. Try again."); }

    const participant = await joinSession(session.id, resolveName(""));
    if (!participant) { setLoading(false); return setError("Something went wrong. Try again."); }

    setParticipantId(session.code, participant.id);
    setIsHost(session.code);
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
    router.push(`/session/${session.code}`);
  }

  // CINEMA_HIDDEN: showStreaming always true, showCinema always false
  const showStreaming = true;
  // const showCinema = watchMode === "cinema" || watchMode === "both";

  return (
    <main className="h-dvh overflow-y-auto flex flex-col items-center justify-center px-5 py-8"
      style={{ background: "var(--bg)" }}>

      {/* Three-dot button — top-right corner */}
      <button
        onClick={() => setInfoOpen(true)}
        className="fixed top-4 right-4 z-40 flex items-center justify-center w-9 h-9 rounded-full transition-all"
        style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)" }}
        aria-label="Info"
      >
        <Mail size={15} />
      </button>

      <InfoPanel open={infoOpen} onClose={() => setInfoOpen(false)} />

      <div className="mb-10 text-center">
        <div className="flex justify-center mb-3">
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
              className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
              style={{
                background: tab === t ? "var(--surface-2)" : "transparent",
                color: tab === t ? "var(--text)" : "var(--text-muted)",
              }}>
              {t === "create" ? "New" : "Join"}
            </button>
          ))}
        </div>
      </div>

      {tab === "create" && (
        <form onSubmit={handleCreate} className="w-full max-w-sm space-y-5">
          {/* NAME_INPUT_HIDDEN: name field removed — random character assigned automatically
          <Field label="Your name">
            <input type="text" placeholder={namePlaceholder} value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none placeholder:opacity-30"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
              autoFocus />
          </Field>
          */}

          {/* CINEMA_HIDDEN: "Watching at" field removed — re-enable when cinema returns */}

          {/* Streaming services + region picker */}
          {showStreaming && (
            <div className="space-y-2">
              {/* Label row with region selector on the right */}
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium uppercase tracking-wider"
                  style={{ color: "var(--text-muted)" }}>Streaming services</label>
                {/* Region picker — pill shows current, click opens 3-col grid */}
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
              <div className="relative">
                <button type="button" onClick={() => setStreamingOpen(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors"
                  style={{
                    background: "var(--surface)",
                    border: `1px solid ${streamingOpen ? "var(--accent)" : "var(--border)"}`,
                  }}>
                  <span className="flex items-center gap-1.5">
                    {selectedServices.length === 0
                      ? <span className="text-sm" style={{ color: "var(--text-muted)", opacity: 0.3 }}>None selected</span>
                      : selectedServices.map(id => {
                          const svc = regionServices.find(s => s.id === id);
                          if (!svc) return null;
                          return (
                            <span key={id}
                              className="relative inline-flex items-center justify-center w-6 h-6 rounded text-[8px] font-bold shrink-0"
                              style={{ background: svc.color, color: "#fff" }}>
                              {svc.abbrev}
                              {svc.tmdbLogoPath && (
                                <img
                                  src={`https://image.tmdb.org/t/p/w45${svc.tmdbLogoPath}`}
                                  alt={svc.name}
                                  className="absolute inset-0 w-6 h-6 rounded"
                                  style={{ objectFit: "cover" }}
                                  onError={e => { e.currentTarget.style.display = "none"; }} />
                              )}
                            </span>
                          );
                        })
                    }
                  </span>
                  <ChevronDown size={15} style={{
                    color: "var(--text-muted)",
                    transform: streamingOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s",
                  }} />
                </button>
                {/* Floating popover — overlays layout so nothing shifts */}
                {streamingOpen && (
                  <div className="absolute left-0 right-0 z-50 mt-1 p-3 rounded-xl flex flex-wrap gap-2"
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                    }}>
                    {regionServices.map((svc) => {
                      const on = selectedServices.includes(svc.id);
                      return (
                        <button key={svc.id} type="button" onClick={() => toggleService(svc.id)}
                          className="px-3 py-1.5 rounded-full text-xs font-medium border transition-all"
                          style={{
                            background: on ? svc.color : "var(--surface)",
                            borderColor: on ? svc.color : "var(--border)",
                            color: on ? "#fff" : "var(--text-muted)",
                            opacity: on ? 1 : 0.8,
                          }}>
                          {svc.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CINEMA_HIDDEN: CinemaDatePicker removed — re-enable when cinema returns */}

          {error && <p className="text-sm" style={{ color: "var(--dislike)" }}>{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity"
            style={{ background: "var(--accent)", color: "#0c0c0e", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Starting..." : <><span>Start</span><ChevronRight size={16} /></>}
          </button>
        </form>
      )}

      {tab === "join" && (
        <form onSubmit={handleJoin} className="w-full max-w-sm space-y-5">
          <Field label="Code">
            <input type="text" placeholder="WOLF-42" value={joinCode}
              onChange={handleJoinCodeChange}
              maxLength={7}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none tracking-widest font-mono"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--accent)" }}
              autoFocus />
          </Field>
          {/* NAME_INPUT_HIDDEN: name field removed — random character assigned automatically
          <Field label="Your name">
            <input type="text" placeholder={namePlaceholder} value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none placeholder:opacity-30"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }} />
          </Field>
          */}
          {error && <p className="text-sm" style={{ color: "var(--dislike)" }}>{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity"
            style={{ background: "var(--accent)", color: "#0c0c0e", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Joining..." : <><Users size={16} /><span>Join</span></>}
          </button>
        </form>
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
