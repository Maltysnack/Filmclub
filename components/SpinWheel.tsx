"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useAnimation } from "framer-motion";
import { Match } from "@/types";
import { posterUrl } from "@/lib/tmdb";
import { supabase } from "@/lib/supabase";
import Logo from "@/components/Logo";

interface SpinWheelProps {
  films: Match[];
  winnerId: string;
  onComplete: () => void;
  /** Called when 50%+ of participants vote to respin. Receives the film to exclude. */
  onRespin?: (excludeFilmId: string) => void;
  participantId?: string;
  totalParticipants?: number;
  sessionId?: string;
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  }
  return Math.abs(h);
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

const RESPIN_SECONDS = 8;

export default function SpinWheel({
  films, winnerId, onComplete, onRespin,
  participantId, totalParticipants = 1, sessionId,
}: SpinWheelProps) {
  const controls = useAnimation();
  const [finished, setFinished] = useState(false);
  const resolvedRef = useRef(false);

  // Respin vote state
  const [respinVoters, setRespinVoters] = useState<Set<string>>(new Set());
  const [respinCountdown, setRespinCountdown] = useState(RESPIN_SECONDS);
  const [hasVoted, setHasVoted] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const sorted = [...films].sort((a, b) =>
    (a.film?.title ?? "").localeCompare(b.film?.title ?? "")
  );

  const n = sorted.length;
  const segAngle = 360 / n;
  const winnerIndex = sorted.findIndex((m) => m.film_id === winnerId);
  const winnerCenterAngle = winnerIndex * segAngle + segAngle / 2;
  const offsetToTop = (360 - winnerCenterAngle + 360) % 360;
  const fullSpins = n > 12 ? 2 : 3 + (hashStr(winnerId) % 2);
  const totalRotation = fullSpins * 360 + offsetToTop;
  const overshootDeg = 4;
  const winnerFilm = sorted[winnerIndex]?.film;

  // Wheel geometry
  const SVG = 300;
  const cx = SVG / 2;
  const cy = SVG / 2;
  const orbitR = 95;
  const maxArcWidth = 2 * orbitR * Math.sin(Math.PI / n) * 0.78;
  const posterW = Math.min(68, maxArcWidth);
  const posterH = posterW * 1.5;
  const cornerR = posterW * 0.1;
  // Top poster centre in SVG space — pinned to screen centre
  const topPosterY = cy - orbitR;
  // Scale so the top poster always appears at ~140px on screen
  const targetPosterPx = 140;
  const scale = Math.max(1, targetPosterPx / posterW);
  // On-screen poster height (constant when scale > 1)
  const screenPosterH = Math.max(posterH, targetPosterPx * 1.5);

  const canRespin = !!onRespin && !!participantId && !!sessionId && films.length > 1;
  const respinThreshold = Math.ceil(totalParticipants / 2);
  const respinPassed = respinVoters.size >= respinThreshold;

  // ── Start animation ────────────────────────────────────────────────────────
  useEffect(() => {
    controls.start({
      rotate: [0, totalRotation + overshootDeg, totalRotation],
      transition: {
        duration: 18,                    // 50% slower than previous 12s
        times: [0, 0.88, 1.0],
        ease: [
          [0.3, 0.0, 0.8, 1.0],         // spin phase
          [0.0, 0.0, 0.6, 1.0],         // settle phase — also 50% slower (x2=0.6 vs 0.4)
        ],
      },
    }).then(() => {
      setFinished(true);
      if (!canRespin && !resolvedRef.current) {
        resolvedRef.current = true;
        setTimeout(onComplete, 1200);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Respin broadcast channel ───────────────────────────────────────────────
  useEffect(() => {
    if (!finished || !canRespin) return;

    const ch = supabase
      .channel(`respin:${sessionId}:${winnerId}`)
      .on("broadcast", { event: "vote" }, ({ payload }) => {
        setRespinVoters((prev) => new Set([...prev, payload.participantId as string]));
      })
      .subscribe();
    channelRef.current = ch;

    const timer = setInterval(() => {
      setRespinCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      supabase.removeChannel(ch);
      clearInterval(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  // ── Resolve respin outcome ─────────────────────────────────────────────────
  useEffect(() => {
    if (!finished || !canRespin || resolvedRef.current) return;
    if (respinPassed) {
      resolvedRef.current = true;
      onRespin!(winnerId);
    } else if (respinCountdown === 0) {
      resolvedRef.current = true;
      onComplete();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [respinVoters.size, respinCountdown, finished]);

  const handleVoteRespin = async () => {
    if (hasVoted || !channelRef.current || !participantId) return;
    setHasVoted(true);
    // Apply own vote immediately for instant feedback
    setRespinVoters((prev) => new Set([...prev, participantId]));
    await channelRef.current.send({
      type: "broadcast",
      event: "vote",
      payload: { participantId },
    });
  };

  return (
    // overflow:hidden clips the wheel outside the viewport
    <div className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.92)" }}>
      {/* Constrain to phone width — overflow:hidden here clips the wheel to this box */}
      <div className="relative h-full mx-auto" style={{ maxWidth: 480, overflow: "hidden" }}>

        {/* Header — logo + status */}
        <div className="absolute top-0 left-0 right-0 flex flex-col items-center pt-10 gap-2">
          <Logo size="sm" showText />
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {finished ? "" : "Spinning…"}
          </p>
        </div>

        {/* Pointer triangle — pinned just above the centred hot-seat poster */}
        <div style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: `translate(-50%, -${Math.round(screenPosterH / 2) + 22}px)`,
          zIndex: 2,
          width: 0, height: 0,
          borderLeft: "10px solid transparent",
          borderRight: "10px solid transparent",
          borderBottom: "18px solid white",
        }} />

        {/*
          Wheel wrapper:
          • positioned so SVG point (cx, topPosterY) maps to screen centre
          • scaled from that same point — top poster stays dead-centre at any n
        */}
        <div style={{
          position: "absolute",
          left: `calc(50% - ${cx}px)`,
          top: `calc(50% - ${topPosterY}px)`,
          width: SVG,
          transformOrigin: `${cx}px ${topPosterY}px`,
          transform: `scale(${scale})`,
        }}>
          <motion.div animate={controls} style={{ transformOrigin: "center", width: SVG, height: SVG }}>
            <svg width={SVG} height={SVG} viewBox={`0 0 ${SVG} ${SVG}`}>

              {sorted.map((match, i) => {
                const midAngle = i * segAngle + segAngle / 2;
                const pos = polarToCartesian(cx, cy, orbitR, midAngle);
                const src = match.film?.poster_path
                  ? posterUrl(match.film.poster_path, "w342")
                  : null;
                const isWinner = match.film_id === winnerId;

                return (
                  <g key={match.film_id} transform={`rotate(${midAngle}, ${pos.x}, ${pos.y})`}>
                    <defs>
                      <clipPath id={`card-clip-${i}`}>
                        <rect x={pos.x - posterW / 2} y={pos.y - posterH / 2}
                          width={posterW} height={posterH} rx={cornerR} ry={cornerR} />
                      </clipPath>
                    </defs>
                    <rect
                      x={pos.x - posterW / 2} y={pos.y - posterH / 2}
                      width={posterW} height={posterH} rx={cornerR} ry={cornerR}
                      fill="#1a1a1a"
                      stroke={finished && isWinner ? "#ffffff" : "rgba(255,255,255,0.15)"}
                      strokeWidth={finished && isWinner ? 2 : 1}
                    />
                    {src && (
                      <image
                        href={src}
                        x={pos.x - posterW / 2} y={pos.y - posterH / 2}
                        width={posterW} height={posterH}
                        preserveAspectRatio="xMidYMid slice"
                        clipPath={`url(#card-clip-${i})`}
                      />
                    )}
                  </g>
                );
              })}

              {/* Hub — camera icon from the Filmclub logo */}
              <circle cx={cx} cy={cy} r={20} fill="#0c0c0e" />
              <g transform={`translate(${cx - 24 * 0.6}, ${cy - 24 * 0.6}) scale(0.6)`}>
                <rect x="4" y="14" width="40" height="26" rx="3" fill="#1c1c20" stroke="#e8b86d" strokeWidth="1.5" />
                <rect x="14" y="8" width="16" height="7" rx="2" fill="#1c1c20" stroke="#e8b86d" strokeWidth="1.5" />
                <circle cx="22" cy="27" r="9" fill="#0c0c0e" stroke="#e8b86d" strokeWidth="1.5" />
                <circle cx="22" cy="27" r="5.5" fill="#141416" stroke="#e8b86d" strokeWidth="1" />
                <circle cx="20" cy="25" r="1.5" fill="#e8b86d" opacity="0.4" />
                <line x1="34" y1="18" x2="34" y2="36" stroke="#e8b86d" strokeWidth="1" opacity="0.5" />
                <line x1="37" y1="18" x2="37" y2="36" stroke="#e8b86d" strokeWidth="1" opacity="0.5" />
                <line x1="40" y1="18" x2="40" y2="36" stroke="#e8b86d" strokeWidth="1" opacity="0.5" />
                <circle cx="38" cy="12" r="3" fill="#e8b86d" opacity="0.8" />
                <path d="M4 38 Q8 44 14 42 Q18 40 22 43 Q26 46 30 42 Q36 38 44 40"
                  stroke="#e8b86d" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.55" />
              </g>
            </svg>
          </motion.div>
        </div>

        {/* Winner title — just below the centred poster */}
        {finished && winnerFilm && (
          <p className="absolute left-0 right-0 text-xl font-bold text-center px-8"
            style={{
              color: "var(--text)",
              top: `calc(50% + ${Math.round(screenPosterH / 2) + 16}px)`,
            }}>
            {winnerFilm.title}
          </p>
        )}

        {/* Respin vote panel */}
        {finished && canRespin && !resolvedRef.current && (
          <div className="absolute bottom-8 left-5 right-5">
            <div className="rounded-2xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                  Respin?
                </p>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
                  {respinCountdown}s
                </span>
              </div>
              <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
                {respinVoters.size} of {respinThreshold} votes needed to respin
              </p>
              {!hasVoted ? (
                <button
                  onClick={handleVoteRespin}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: "var(--accent)", color: "#0c0c0e" }}
                >
                  Vote to respin
                </button>
              ) : (
                <div className="w-full py-2.5 rounded-xl text-sm text-center" style={{ background: "var(--surface-2)", color: "var(--accent)" }}>
                  ✓ Voted
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
