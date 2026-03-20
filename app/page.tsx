"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { createSession, joinSession, getSession, setParticipantId } from "@/lib/session";
import { Calendar, Zap, ChevronRight, Users } from "lucide-react";

type Tab = "create" | "join";
type Mode = "planned" | "live";

export default function Home() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("create");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create form
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("live");
  const [deadline, setDeadline] = useState("");
  const [threshold, setThreshold] = useState(100);

  // Join form
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Enter your name");
    if (mode === "planned" && !deadline) return setError("Set a deadline for planned mode");

    setLoading(true);
    setError(null);

    const session = await createSession(
      mode,
      mode === "planned" ? new Date(deadline).toISOString() : null,
      threshold
    );
    if (!session) { setLoading(false); return setError("Something went wrong. Try again."); }

    const participant = await joinSession(session.id, name.trim());
    if (!participant) { setLoading(false); return setError("Something went wrong. Try again."); }

    setParticipantId(session.code, participant.id);
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

  return (
    <main
      className="min-h-dvh flex flex-col items-center justify-center px-5 py-12"
      style={{ background: "var(--bg)" }}
    >
      <div className="mb-12 text-center">
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
            <button
              key={t}
              onClick={() => { setTab(t); setError(null); }}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
              style={{
                background: tab === t ? "var(--surface-2)" : "transparent",
                color: tab === t ? "var(--text)" : "var(--text-muted)",
              }}
            >
              {t === "create" ? "New session" : "Join session"}
            </button>
          ))}
        </div>
      </div>

      {tab === "create" && (
        <form onSubmit={handleCreate} className="w-full max-w-sm space-y-5">
          <Field label="Your name">
            <input
              type="text"
              placeholder="e.g. Milo"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-colors"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
              autoFocus
            />
          </Field>

          <Field label="Mode">
            <div className="grid grid-cols-2 gap-3">
              <ModeCard
                selected={mode === "live"}
                onClick={() => setMode("live")}
                icon={<Zap size={16} />}
                title="Live"
                desc="On the couch. First match wins."
              />
              <ModeCard
                selected={mode === "planned"}
                onClick={() => setMode("planned")}
                icon={<Calendar size={16} />}
                title="Planned"
                desc="Swipe over days. Results at deadline."
              />
            </div>
          </Field>

          {mode === "planned" && (
            <Field label="Deadline">
              <input
                type="datetime-local"
                defaultValue={defaultDeadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  colorScheme: "dark",
                }}
              />
            </Field>
          )}

          {mode === "live" && (
            <Field label={`Match threshold — ${threshold === 100 ? "unanimous" : `${threshold}%`}`}>
              <input
                type="range"
                min={50}
                max={100}
                step={10}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full"
                style={{ accentColor: "var(--accent)" }}
              />
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                {threshold === 100
                  ? "Everyone in the session must like it"
                  : `${threshold}% of the group must like it`}
              </p>
            </Field>
          )}

          {error && <p className="text-sm" style={{ color: "var(--dislike)" }}>{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity"
            style={{
              background: "var(--accent)",
              color: "#0c0c0e",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Creating..." : <><span>Create session</span><ChevronRight size={16} /></>}
          </button>
        </form>
      )}

      {tab === "join" && (
        <form onSubmit={handleJoin} className="w-full max-w-sm space-y-5">
          <Field label="Your name">
            <input
              type="text"
              placeholder="e.g. Milo"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--text)",
              }}
              autoFocus
            />
          </Field>
          <Field label="Session code">
            <input
              type="text"
              placeholder="WOLF-42"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              className="w-full px-4 py-3 rounded-xl text-sm outline-none tracking-widest font-mono"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                color: "var(--accent)",
              }}
            />
          </Field>

          {error && <p className="text-sm" style={{ color: "var(--dislike)" }}>{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity"
            style={{
              background: "var(--accent)",
              color: "#0c0c0e",
              opacity: loading ? 0.6 : 1,
            }}
          >
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
        style={{ color: "var(--text-muted)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ModeCard({
  selected, onClick, icon, title, desc,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-3 rounded-xl text-left transition-all duration-200 border"
      style={{
        background: selected ? "var(--surface-2)" : "var(--surface)",
        borderColor: selected ? "var(--accent)" : "var(--border)",
      }}
    >
      <div className="mb-1.5" style={{ color: selected ? "var(--accent)" : "var(--text-muted)" }}>
        {icon}
      </div>
      <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{title}</div>
      <div className="text-xs mt-0.5 leading-snug" style={{ color: "var(--text-muted)" }}>{desc}</div>
    </button>
  );
}
