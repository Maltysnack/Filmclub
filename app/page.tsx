"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import DendyLogo from "@/components/DendyLogo";
import { createSession, joinSession, getSession, getParticipants, setParticipantId, setIsHost } from "@/lib/session";
import { AU_SERVICES } from "@/lib/streaming";
import { Calendar, Zap, ChevronRight, ChevronDown, Users, Home as HomeIcon, Clapperboard } from "lucide-react";
import type { WatchMode } from "@/types";

type Tab = "create" | "join";
type SessionMode = "planned" | "live";

export default function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("create");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [mode, setMode] = useState<SessionMode>("live");
  const [deadline, setDeadline] = useState("");
  const [threshold, setThreshold] = useState(100);
  const [watchMode, setWatchMode] = useState<WatchMode>("home");
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [cinemaDate, setCinemaDate] = useState("");
  const [cinemaFrom, setCinemaFrom] = useState("");
  const [cinemaTo, setCinemaTo] = useState("");
  const [streamingOpen, setStreamingOpen] = useState(false);

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
    if (trimmed.toLowerCase() === "tom") return "Blue Bandit";
    if (trimmed.toLowerCase() === "pop") return "Pop ❤️";
    if (trimmed.toLowerCase() === "poppy") return "Poppy ❤️";
    return trimmed;
  }

  function normaliseCode(raw: string): string {
    // Strip any hyphens then reinsert after position 4 (WORD-NN format)
    const stripped = raw.trim().toUpperCase().replace(/-/g, "");
    if (stripped.length > 4) return `${stripped.slice(0, 4)}-${stripped.slice(4)}`;
    return stripped;
  }

  function toggleService(id: string) {
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    // empty name defaults to Red Rebel — no validation error needed
    if (mode === "planned" && !deadline) return setError("Set a deadline for planned mode");
    if ((watchMode === "home" || watchMode === "both") && selectedServices.length === 0)
      return setError("Select at least one streaming service");
    if (mode === "planned" && (watchMode === "cinema" || watchMode === "both") && !cinemaDate)
      return setError("Pick a date for the cinema session");

    setLoading(true);
    setError(null);

    // For live + cinema: auto-use today's date and current time as the from-time
    // so only sessions happening from now onwards are included.
    const now = new Date();
    const todayDate = now.toISOString().slice(0, 10);
    const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const resolvedCinemaDate = watchMode !== "home"
      ? (mode === "live" ? todayDate : cinemaDate)
      : null;
    const resolvedCinemaFrom = watchMode !== "home"
      ? (mode === "live" ? nowTime : (cinemaFrom || null))
      : null;
    const resolvedCinemaTo = watchMode !== "home" && mode === "planned"
      ? (cinemaTo || null)
      : null;

    const session = await createSession(
      mode,
      mode === "planned" ? new Date(deadline).toISOString() : null,
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
    // empty name defaults to Red Rebel
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

  const defaultDeadline = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(12, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  })();

  const minDate = new Date().toISOString().slice(0, 10);

  const showStreaming = watchMode === "home" || watchMode === "both";
  const showCinema = watchMode === "cinema" || watchMode === "both";

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-5 py-12"
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
                icon={<Zap size={16} />} title="Live"
                desc="On the couch. First match wins." />
              <ModeCard selected={mode === "planned"} onClick={() => setMode("planned")}
                icon={<Calendar size={16} />} title="Planned"
                desc="Swipe over days. Results at deadline." />
            </div>
          </Field>

          {mode === "planned" && (
            <Field label="Deadline">
              <input type="datetime-local" defaultValue={defaultDeadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", colorScheme: "dark" }} />
            </Field>
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
            <div>
              <button type="button" onClick={() => setStreamingOpen(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <span className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
                  Streaming services available
                  {selectedServices.length > 0 && (
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: "var(--accent)", color: "#0c0c0e" }}>
                      {selectedServices.length}
                    </span>
                  )}
                </span>
                <ChevronDown size={15} style={{
                  color: "var(--text-muted)",
                  transform: streamingOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                }} />
              </button>
              {streamingOpen && (
                <div className="flex flex-wrap gap-2 mt-2 px-1">
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
          )}

          {/* Cinema options */}
          {showCinema && mode === "live" && (
            <div className="px-4 py-3 rounded-xl text-sm"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div className="mb-1"><DendyLogo height={14} /></div>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Sessions showing from now today will appear in the pool automatically.
              </p>
            </div>
          )}

          {showCinema && mode === "planned" && (
            <Field label="Cinema date & time window">
              <div className="flex items-center gap-2">
                <input type="date" min={minDate} value={cinemaDate}
                  onChange={(e) => setCinemaDate(e.target.value)}
                  className="flex-1 px-3 py-2.5 rounded-xl text-sm outline-none min-w-0"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", colorScheme: "dark" }} />
                <input type="time" value={cinemaFrom}
                  onChange={(e) => setCinemaFrom(e.target.value)}
                  className="w-24 px-2 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", colorScheme: "dark" }} />
                <span className="text-xs shrink-0" style={{ color: "var(--text-muted)" }}>→</span>
                <input type="time" value={cinemaTo}
                  onChange={(e) => setCinemaTo(e.target.value)}
                  className="w-24 px-2 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", colorScheme: "dark" }} />
              </div>
            </Field>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium uppercase tracking-wider"
        style={{ color: "var(--text-muted)" }}>{label}</label>
      {children}
    </div>
  );
}

function ModeCard({ selected, onClick, icon, title, desc }: {
  selected: boolean; onClick: () => void;
  icon: React.ReactNode; title: string; desc: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className="p-3 rounded-xl text-left transition-all duration-200 border"
      style={{
        background: selected ? "var(--surface-2)" : "var(--surface)",
        borderColor: selected ? "var(--accent)" : "var(--border)",
      }}>
      <div className="mb-1.5" style={{ color: selected ? "var(--accent)" : "var(--text-muted)" }}>{icon}</div>
      <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{title}</div>
      <div className="text-xs mt-0.5 leading-snug" style={{ color: "var(--text-muted)" }}>{desc}</div>
    </button>
  );
}
