"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Trophy, Lock, Clock, Plus, Layers, Info } from "lucide-react";
import { getSession, getParticipantId, getFilmScores, closeSession, getParticipants } from "@/lib/session";
import { posterUrl } from "@/lib/tmdb";
import { Film, Session, Participant } from "@/types";
import Logo from "@/components/Logo";
import FilmInfoOverlay from "@/components/FilmInfoOverlay";

interface FilmScore {
  film: Film;
  score: number;
  total: number;
  likedByIds: string[];
}

export default function ResultsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<Session | null>(null);
  const [scores, setScores] = useState<FilmScore[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [infoFilm, setInfoFilm] = useState<Film | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [isCreator] = useState(() => {
    // We treat whoever has the participant ID as potentially the creator
    // (first participant — check by order would require more state, so we allow anyone to close)
    return true;
  });

  useEffect(() => {
    async function init() {
      const s = await getSession(code);
      if (!s) return router.push("/");
      const pid = getParticipantId(code);
      if (!pid) return router.push("/");

      setSession(s);

      const [allScores, allParticipants] = await Promise.all([
        getFilmScores(s.id),
        getParticipants(s.id),
      ]);
      const tiebreakerIds = s.tiebreaker_film_ids?.length ? new Set(s.tiebreaker_film_ids) : null;
      const filtered = allScores
        .filter((fs) => fs.score > 0)
        .filter((fs) => !tiebreakerIds || tiebreakerIds.has(fs.film.id))
        .slice(0, 20);
      setScores(filtered);
      setParticipants(allParticipants);
      setLoading(false);
    }
    init();
  }, [code, router]);

  async function handleClose() {
    if (!session) return;
    setClosing(true);
    await closeSession(session.id);
    setSession((s) => s ? { ...s, status: "closed" } : s);
    setClosing(false);
  }

  const deadlineDate = session?.deadline ? new Date(session.deadline) : null;
  const isPast = deadlineDate ? deadlineDate < new Date() : false;
  const topFilm = scores[0];

  return (
    <div className="min-h-dvh" style={{ background: "var(--bg)" }}>
    <div className="flex flex-col min-h-dvh mx-auto" style={{ maxWidth: 480 }}>
      {/* Header */}
      <header className="flex items-center gap-3 px-5 pt-5 pb-4 shrink-0">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg"
          style={{ background: "var(--surface)", color: "var(--text-muted)" }}
        >
          <ArrowLeft size={18} />
        </button>
        <Logo size="sm" showText={false} />
        <div className="flex-1">
          <h1 className="text-base font-semibold" style={{ color: "var(--text)" }}>Results</h1>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{code}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push(`/session/${code}/add`)}
            className="p-2 rounded-lg"
            style={{ background: "var(--surface)", color: "var(--accent)" }}>
            <Plus size={18} />
          </button>
          <button onClick={() => router.back()}
            className="p-2 rounded-lg"
            style={{ background: "var(--surface)", color: "var(--text-muted)" }}>
            <Layers size={18} />
          </button>
          <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
            style={{
              background: session?.status === "closed" ? "rgba(74,222,128,0.1)" : "var(--surface)",
              color: session?.status === "closed" ? "var(--like)" : "var(--text-muted)",
            }}>
            {session?.status === "closed" ? <Lock size={11} /> : <Clock size={11} />}
            {session?.status === "closed" ? "Closed" : "Live"}
          </div>
        </div>
      </header>

      {loading && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>Loading…</p>
        </div>
      )}

      {!loading && (
        <div className="flex-1 overflow-y-auto px-5 pb-8">
          {/* Deadline */}
          {session?.mode === "planned" && deadlineDate && (
            <div
              className="mb-5 p-3 rounded-xl flex items-center gap-2 text-sm"
              style={{ background: "var(--surface)", color: isPast ? "var(--like)" : "var(--text-muted)" }}
            >
              {isPast ? <Lock size={14} /> : <Clock size={14} />}
              {isPast
                ? "Deadline passed — these are the final results"
                : `Closes ${deadlineDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`}
            </div>
          )}

          {/* Participants */}
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            {participants.map((p) => {
              const color = participantColor(p.name);
              return (
                <span
                  key={p.id}
                  className="text-xs px-2.5 py-1 rounded-full font-medium"
                  style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
                >
                  {p.name}
                </span>
              );
            })}
          </div>

          {scores.length === 0 ? (
            <div className="text-center py-12">
              <Trophy size={32} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                No likes yet. Get swiping.
              </p>
            </div>
          ) : (
            <>
              {/* Top pick — big */}
              {topFilm && (
                <div className="mb-5">
                  <p className="text-xs font-medium uppercase tracking-wider mb-3"
                    style={{ color: "var(--accent)" }}>
                    Top pick
                  </p>
                  <motion.div
                    className="w-full relative rounded-2xl overflow-hidden text-left"
                    style={{ aspectRatio: "16/9", background: "var(--surface)" }}
                  >
                    <img
                      src={posterUrl(topFilm.film.backdrop_path ?? topFilm.film.poster_path, "w500")}
                      alt={topFilm.film.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0" style={{
                      background: "linear-gradient(to top, rgba(12,12,14,0.95) 0%, transparent 60%)",
                    }} />
                    <div className="absolute bottom-4 left-4 right-4">
                      <h2 className="text-lg font-semibold mb-1" style={{ color: "var(--text)" }}>
                        {topFilm.film.title}
                      </h2>
                      <ScoreBar score={topFilm.score} total={topFilm.total} highlight />
                      <LikedByNames ids={topFilm.likedByIds} participants={participants} />
                    </div>
                    <button
                      onClick={() => setInfoFilm(topFilm.film)}
                      className="absolute top-3 right-3 p-1.5 rounded-full"
                      style={{ background: "rgba(0,0,0,0.55)", color: "white" }}
                    >
                      <Info size={14} />
                    </button>
                  </motion.div>
                </div>
              )}

              {/* Rest of the list */}
              {scores.slice(1).length > 0 && (
                <>
                  <p className="text-xs font-medium uppercase tracking-wider mb-3"
                    style={{ color: "var(--text-muted)" }}>
                    Also liked
                  </p>
                  <div className="space-y-2">
                    {scores.slice(1).map(({ film, score, total, likedByIds }, i) => (
                      <motion.div
                        key={film.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="w-full flex items-center gap-3 p-3 rounded-xl"
                        style={{ background: "var(--surface)" }}
                      >
                        <div className="w-10 rounded-lg overflow-hidden shrink-0"
                          style={{ aspectRatio: "2/3" }}>
                          <img
                            src={posterUrl(film.poster_path, "w500")}
                            alt={film.title}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: "var(--text)" }}>
                            {film.title}
                          </p>
                          <p className="text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>
                            {film.release_year}
                          </p>
                          <ScoreBar score={score} total={total} />
                          <LikedByNames ids={likedByIds} participants={participants} />
                        </div>
                        <button
                          onClick={() => setInfoFilm(film)}
                          className="shrink-0 p-1.5 rounded-full ml-1"
                          style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
                        >
                          <Info size={14} />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                </>
              )}

              {/* Close session button for planned mode */}
              {session?.mode === "planned" && session.status === "active" && (
                <button
                  onClick={handleClose}
                  disabled={closing}
                  className="w-full mt-6 py-3.5 rounded-xl text-sm font-semibold border transition-opacity"
                  style={{
                    borderColor: "var(--accent)",
                    color: "var(--accent)",
                    opacity: closing ? 0.6 : 1,
                  }}
                >
                  {closing ? "Closing…" : "Lock in results"}
                </button>
              )}
            </>
          )}
        </div>
      )}

      <FilmInfoOverlay
        film={infoFilm}
        onClose={() => setInfoFilm(null)}
        sessionServices={session?.streaming_services ?? []}
      />
    </div>
    </div>
  );
}

const PERSON_COLORS = ["#22c55e","#a855f7","#f97316","#06b6d4","#ec4899","#eab308","#6366f1","#14b8a6"];
function participantColor(name: string): string {
  if (name === "Red Rebel") return "#ef4444";
  if (name === "Blue Bandit") return "#3b82f6";
  let h = 0;
  for (let i = 0; i < name.length; i++) { h = name.charCodeAt(i) + ((h << 5) - h); h |= 0; }
  return PERSON_COLORS[Math.abs(h) % PERSON_COLORS.length];
}

function LikedByNames({ ids, participants }: { ids: string[]; participants: Participant[] }) {
  if (!ids.length) return null;
  const names = ids
    .map((id) => participants.find((p) => p.id === id)?.name)
    .filter(Boolean) as string[];
  if (!names.length) return null;
  return (
    <p className="text-xs mt-1.5 truncate" style={{ color: "var(--text-muted)" }}>
      {names.join(", ")}
    </p>
  );
}

function ScoreBar({ score, total, highlight = false }: { score: number; total: number; highlight?: boolean }) {
  const pct = total > 0 ? (score / total) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: highlight ? "var(--accent)" : "var(--text-muted)",
          }}
        />
      </div>
      <span className="text-xs shrink-0"
        style={{ color: highlight ? "var(--accent)" : "var(--text-muted)" }}>
        {score}/{total}
      </span>
    </div>
  );
}
