"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { createSession, joinSession, getSession, setParticipantId, setIsHost } from "@/lib/session";
import { AU_SERVICES } from "@/lib/streaming";
import { Calendar, Zap, ChevronRight, Users, Home as HomeIcon, Clapperboard } from "lucide-react";
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

  // Join form
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");

  function toggleService(id: string) {
    setSelectedServices((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Enter your name");
    if (mode === "planned" && !deadline) return setError("Set a deadline for planned mode");
    if ((watchMode === "home" || watchMode === "both") && selectedServices.length === 0)
      return setError("Select at least one streaming service");
    if ((watchMode === "cinema" || watchMode === "both") && !cinemaDate)
      return setError("Pick a date for the cinema session");

    setLoading(true);
    setError(null);

    const session = await createSession(
      mode,
      mode === "planned" ? new Date(deadline).toISOString() : null,
      threshold,
      watchMode,
      watchMode !== "cinema" ? selectedServices : [],
      watchMode !== "home" ? cinemaDate : null,
      watchMode !== "home" && cinemaFrom ? cinemaFrom : null,
      watchMode !== "home" && cinemaTo ? cinemaTo : null,
    );
    if (!session) { setLoading(false); return setError("Something went wrong. Try again."); }

    const participant = await joinSession(session.id, name.trim());
    if (!participant) { setLoading(false); return setError("Something went wrong. Try again."); }

    setParticipantId(session.code, participant.id);
    setIsHost(session.code);
    router.push(`/session/${session.code}`);
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinName.trim()) return setError("Enter your name");
    if (!joinCode.trim()) return setError("Enter the session code");

    setLoading(true);
    setError(null);

    const code = joinCode.trim().toUpperCase();
    const session = await getSession(code);
    if (!session) { setLoading(false); return setError("Session not found. Check the code."); }
    if (session.status === "closed") { setLoading(false); return setError("This session has ended."); }

    const participant = await joinSession(session.id, joinName.trim());
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

          {mode === "live" && (
            <Field label={`Match threshold — ${threshold === 100 ? "unanimous" : `${threshold}%`}`}>
              <input type="range" min={50} max={100} step={10} value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full" style={{ accentColor: "var(--accent)" }} />
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {threshold === 100 ? "Everyone must like it" : `${threshold}% of the group must like it`}
              </p>
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
            <Field label="Streaming services available">
              <div className="flex flex-wrap gap-2">
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
              <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
                Only films available on these services will be shown
              </p>
            </Field>
          )}

          {/* Cinema options */}
          {showCinema && (
            <>
              <Field label="Cinema date">
                <input type="date" min={minDate} value={cinemaDate}
                  onChange={(e) => setCinemaDate(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", colorScheme: "dark" }} />
              </Field>
              <Field label="Session time window (optional)">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>From</p>
                    <input type="time" value={cinemaFrom}
                      onChange={(e) => setCinemaFrom(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", colorScheme: "dark" }} />
                  </div>
                  <div>
                    <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>To</p>
                    <input type="time" value={cinemaTo}
                      onChange={(e) => setCinemaTo(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", colorScheme: "dark" }} />
                  </div>
                </div>
                <p className="text-xs mt-1.5" style={{ color: "var(--text-muted)" }}>
                  Only films with sessions in this window will appear
                </p>
              </Field>
            </>
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
