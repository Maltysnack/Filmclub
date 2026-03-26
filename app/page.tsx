"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import DendyLogo from "@/components/DendyLogo";
import { createSession, joinSession, getSession, getParticipants, setParticipantId, setIsHost } from "@/lib/session";
import { AU_SERVICES } from "@/lib/streaming";
import { Calendar, Zap, ChevronRight, ChevronDown, Users, Home as HomeIcon, Clapperboard } from "lucide-react";
import type { WatchMode } from "@/types";

type Tab = "create" | "join";
type SessionMode = "planned" | "live";

// ── date / time helpers ───────────────────────────────────────────────────────

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

/** Format "HH:MM" → 12hr am/pm */
function fmtTime(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr), m = parseInt(mStr);
  const period = h < 12 ? "am" : "pm";
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${dh}${period}` : `${dh}:${String(m).padStart(2, "0")}${period}`;
}

/** "Tuesday 25th March 9pm" */
function formatDatetime(dateStr: string, time: string): string {
  if (!dateStr || !time) return "";
  const d = new Date(dateStr + "T12:00:00");
  const weekday = d.toLocaleDateString("en-AU", { weekday: "long" });
  const month   = d.toLocaleDateString("en-AU", { month: "long" });
  return `${weekday} ${ordinal(d.getDate())} ${month} ${fmtTime(time)}`;
}

/** "Tuesday 25th March 6pm – 8pm" */
function formatCinema(dateStr: string, from: string, to: string): string {
  if (!dateStr || !from || !to) return "";
  const d = new Date(dateStr + "T12:00:00");
  const weekday = d.toLocaleDateString("en-AU", { weekday: "long" });
  const month   = d.toLocaleDateString("en-AU", { month: "long" });
  return `${weekday} ${ordinal(d.getDate())} ${month} ${fmtTime(from)} – ${fmtTime(to)}`;
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("create");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [mode, setMode] = useState<SessionMode>("live");
  const [threshold] = useState(100);
  const [watchMode, setWatchMode] = useState<WatchMode>("home");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [streamingOpen, setStreamingOpen] = useState(false);

  // Deadline — default: tomorrow at 21:00
  const [deadlineDateStr, setDeadlineDateStr] = useState(() => dateStrFromOffset(1));
  const [deadlineTime, setDeadlineTime] = useState("21:00");

  // Cinema — default: tomorrow 18:00 → 20:00
  const [cinemaDateStr, setCinemaDateStr] = useState(() => dateStrFromOffset(1));
  const [cinemaFromTime, setCinemaFromTime] = useState("18:00");
  const [cinemaToTime, setCinemaToTime] = useState("20:00");

  // Preload streaming service logos so they're instant when the dropdown opens
  useEffect(() => {
    AU_SERVICES.forEach(svc => {
      if (svc.tmdbLogoPath) {
        const img = new window.Image();
        img.src = `https://image.tmdb.org/t/p/w45${svc.tmdbLogoPath}`;
      }
    });
  }, []);

  // Join form
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");

  const MYSTERY_NAMES = [
    "James Bond", "Mr. X", "Mrs. X", "Ethan Hunt",
    "Keyser Söze", "John Doe", "Batman",
  ];

  function pickMysteryName(takenNames: string[]): string {
    const available = MYSTERY_NAMES.filter((n) => !takenNames.includes(n));
    const pool = available.length > 0 ? available : MYSTERY_NAMES;
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
    if ((watchMode === "home" || watchMode === "both") && selectedServices.length === 0)
      return setError("Select at least one streaming service");

    setLoading(true);
    setError(null);

    const deadlineISO = new Date(`${deadlineDateStr}T${deadlineTime}:00`).toISOString();

    const now = new Date();
    const resolvedCinemaDate = watchMode !== "home"
      ? (mode === "live" ? now.toISOString().slice(0, 10) : cinemaDateStr)
      : null;
    const resolvedCinemaFrom = watchMode !== "home"
      ? (mode === "live"
          ? `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
          : cinemaFromTime)
      : null;
    const resolvedCinemaTo = watchMode !== "home" && mode === "planned"
      ? cinemaToTime
      : null;

    const session = await createSession(
      mode,
      mode === "planned" ? deadlineISO : null,
      threshold,
      watchMode,
      watchMode !== "cinema" ? selectedServices : [],
      resolvedCinemaDate,
      resolvedCinemaFrom,
      resolvedCinemaTo,
    );
    if (!session) { setLoading(false); return setError("Something went wrong. Try again."); }

    const participant = await joinSession(session.id, resolveName(name));
    if (!participant) { setLoading(false); return setError("Something went wrong. Try again."); }

    setParticipantId(session.code, participant.id);
    setIsHost(session.code);
    router.push(`/session/${session.code}`);
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim()) return setError("Enter the session code");

    setLoading(true);
    setError(null);

    const code = normaliseCode(joinCode);
    const session = await getSession(code);
    if (!session) { setLoading(false); return setError("Session not found. Check the code."); }
    if (session.status === "closed") { setLoading(false); return setError("This session has ended."); }

    const existing = await getParticipants(session.id);
    const takenNames = existing.map((p) => p.name);
    const participant = await joinSession(session.id, resolveName(joinName, takenNames));
    if (!participant) { setLoading(false); return setError("Something went wrong. Try again."); }

    setParticipantId(session.code, participant.id);
    router.push(`/session/${session.code}`);
  }

  const showStreaming = watchMode === "home" || watchMode === "both";
  const showCinema   = watchMode === "cinema" || watchMode === "both";

  return (
    <main className="h-dvh overflow-y-auto flex flex-col items-center justify-center px-5 py-8"
      style={{ background: "var(--bg)" }}>
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
              {t === "create" ? "New session" : "Join session"}
            </button>
          ))}
        </div>
      </div>

      {tab === "create" && (
        <form onSubmit={handleCreate} className="w-full max-w-sm space-y-5">
          <Field label="Your name">
            <input type="text" placeholder="e.g. Red Rebel" value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
              autoFocus />
          </Field>

          {/* Session mode */}
          <Field label="Session type">
            <div className="grid grid-cols-2 gap-3">
              <ModeCard selected={mode === "live"} onClick={() => setMode("live")}
                icon={<Zap size={16} />} title="Live" />
              <ModeCard selected={mode === "planned"} onClick={() => setMode("planned")}
                icon={<Calendar size={16} />} title="Planned" />
            </div>
          </Field>

          {/* Deadline */}
          {mode === "live" ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}>Deadline for vote</label>
              <div className="w-full px-4 py-3 rounded-xl"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <span className="text-sm font-medium" style={{ color: "var(--text)" }}>First match wins!</span>
              </div>
            </div>
          ) : (
            <DateTimePicker
              label="Deadline for vote"
              dateStr={deadlineDateStr}
              time={deadlineTime}
              onDateChange={setDeadlineDateStr}
              onTimeChange={setDeadlineTime}
            />
          )}

          {/* Watch mode */}
          <Field label="Watching at">
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: "home",   label: "At home",  icon: <HomeIcon size={15} /> },
                { value: "cinema", label: "Cinema",   icon: <Clapperboard size={15} /> },
                { value: "both",   label: "Either",   icon: <span className="text-xs">✦</span> },
              ] as { value: WatchMode; label: string; icon: React.ReactNode }[]).map(({ value, label, icon }) => (
                <button key={value} type="button" onClick={() => setWatchMode(value)}
                  className="flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-medium border transition-all"
                  style={{
                    background: watchMode === value ? "var(--surface-2)" : "var(--surface)",
                    borderColor: watchMode === value ? "var(--accent)" : "var(--border)",
                    color: watchMode === value ? "var(--accent)" : "var(--text-muted)",
                  }}>
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </Field>

          {/* Streaming services */}
          {showStreaming && (
            <div className="space-y-2">
              <label className="block text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}>Streaming services</label>
              <div className="relative">
                <button type="button" onClick={() => setStreamingOpen(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors"
                  style={{
                    background: "var(--surface)",
                    border: `1px solid ${streamingOpen ? "var(--accent)" : "var(--border)"}`,
                  }}>
                  <span className="flex items-center gap-1.5">
                    {selectedServices.length === 0
                      ? <span className="text-sm" style={{ color: "var(--text-muted)" }}>None selected</span>
                      : selectedServices.map(id => {
                          const svc = AU_SERVICES.find(s => s.id === id);
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
                    {AU_SERVICES.map((svc) => {
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

          {/* Cinema — live mode info */}
          {showCinema && mode === "live" && (
            <div className="px-4 py-3 rounded-xl text-sm"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div className="mb-1"><DendyLogo height={14} /></div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Sessions showing from now today will appear in the pool automatically.
              </p>
            </div>
          )}

          {/* Cinema — planned: date + time window */}
          {showCinema && mode === "planned" && (
            <CinemaDatePicker
              dateStr={cinemaDateStr}
              fromTime={cinemaFromTime}
              toTime={cinemaToTime}
              onDateChange={setCinemaDateStr}
              onFromChange={setCinemaFromTime}
              onToChange={setCinemaToTime}
            />
          )}

          {error && <p className="text-sm" style={{ color: "var(--dislike)" }}>{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity"
            style={{ background: "var(--accent)", color: "#0c0c0e", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Creating..." : <><span>Create session</span><ChevronRight size={16} /></>}
          </button>
        </form>
      )}

      {tab === "join" && (
        <form onSubmit={handleJoin} className="w-full max-w-sm space-y-5">
          <Field label="Your name">
            <input type="text" placeholder="e.g. Red Rebel" value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
              autoFocus />
          </Field>
          <Field label="Session code">
            <input type="text" placeholder="WOLF-42" value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none tracking-widest font-mono"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--accent)" }} />
          </Field>
          {error && <p className="text-sm" style={{ color: "var(--dislike)" }}>{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity"
            style={{ background: "var(--accent)", color: "#0c0c0e", opacity: loading ? 0.6 : 1 }}>
            {loading ? "Joining..." : <><Users size={16} /><span>Join session</span></>}
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

function ModeCard({ selected, onClick, icon, title }: {
  selected: boolean; onClick: () => void;
  icon: React.ReactNode; title: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className="px-3 py-2.5 rounded-xl flex items-center gap-2 transition-all duration-200 border"
      style={{
        background: selected ? "var(--surface-2)" : "var(--surface)",
        borderColor: selected ? "var(--accent)" : "var(--border)",
      }}>
      <span style={{ color: selected ? "var(--accent)" : "var(--text-muted)" }}>{icon}</span>
      <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{title}</span>
    </button>
  );
}

function PickerShell({ label, summary, open, onToggle, children }: {
  label: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
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

function DateTimePicker({ label, dateStr, time, onDateChange, onTimeChange }: {
  label: string; dateStr: string; time: string;
  onDateChange: (v: string) => void; onTimeChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <PickerShell label={label} summary={formatDatetime(dateStr, time)}
      open={open} onToggle={() => setOpen(o => !o)}>
      <DayPicker value={dateStr} onChange={onDateChange} />
      <input type="time" value={time} onChange={e => onTimeChange(e.target.value)}
        className="px-3 py-2.5 rounded-xl text-sm outline-none" style={{ width: "42.5%",
          background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", colorScheme: "dark" }} />
    </PickerShell>
  );
}

function CinemaDatePicker({ dateStr, fromTime, toTime, onDateChange, onFromChange, onToChange }: {
  dateStr: string; fromTime: string; toTime: string;
  onDateChange: (v: string) => void; onFromChange: (v: string) => void; onToChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <PickerShell label="Cinema session" summary={formatCinema(dateStr, fromTime, toTime)}
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

/**
 * Row of day-name chips (Today / Tomorrow / Mon … Sun) for the next 7 days.
 * Selecting a chip updates the date string; changing the linked date input
 * automatically highlights the matching chip (or none if out of range).
 */
function DayPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const chips = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const str   = d.toISOString().slice(0, 10);
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow"
      : d.toLocaleDateString("en-AU", { weekday: "short" });
    return { str, label };
  });

  return (
    <div className="flex flex-wrap gap-1">
      {chips.map(({ str, label }) => {
        const active = value === str;
        return (
          <button key={str} type="button" onClick={() => onChange(str)}
            className="px-2 py-0.5 rounded text-xs font-medium border transition-all"
            style={{
              background:   active ? "var(--accent)" : "transparent",
              borderColor:  active ? "var(--accent)" : "var(--border)",
              color:        active ? "#0c0c0e"       : "var(--text-muted)",
            }}>
            {label}
          </button>
        );
      })}
    </div>
  );
}
