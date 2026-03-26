"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useAnimation } from "framer-motion";
import { Match } from "@/types";
import { posterUrl } from "@/lib/tmdb";

interface SpinWheelProps {
  films: Match[];
  winnerId: string;
  onComplete: () => void;
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

export default function SpinWheel({ films, winnerId, onComplete }: SpinWheelProps) {
  const controls = useAnimation();
  const [finished, setFinished] = useState(false);
  const doneRef = useRef(false);

  // Deterministic sort so every device has the same wheel layout
  const sorted = [...films].sort((a, b) =>
    (a.film?.title ?? "").localeCompare(b.film?.title ?? "")
  );

  const n = sorted.length;
  const segAngle = 360 / n;
  const winnerIndex = sorted.findIndex((m) => m.film_id === winnerId);
  const winnerCenterAngle = winnerIndex * segAngle + segAngle / 2;
  const offsetToTop = (360 - winnerCenterAngle + 360) % 360;
  const totalRotation = (6 + (hashStr(winnerId) % 5)) * 360 + offsetToTop;
  const winnerFilm = sorted[winnerIndex]?.film;

  // Poster sizing: fill as much of each segment as possible without overlap
  const SVG = 300;
  const cx = SVG / 2;
  const cy = SVG / 2;
  const orbitR = 95; // distance from wheel centre to poster centre
  const maxArcWidth = 2 * orbitR * Math.sin(Math.PI / n) * 0.78;
  const posterW = Math.min(68, maxArcWidth);
  const posterH = posterW * 1.5; // 2:3 portrait ratio
  const cornerR = posterW * 0.1;

  useEffect(() => {
    controls
      .start({
        rotate: totalRotation,
        transition: {
          duration: 10,
          ease: [0.7, 0.0, 0.95, 1.0],
        },
      })
      .then(() => {
        setFinished(true);
        if (!doneRef.current) {
          doneRef.current = true;
          setTimeout(onComplete, 1200);
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: "rgba(0,0,0,0.92)" }}
    >
      <p className="text-sm mb-6" style={{ color: "var(--text-muted)" }}>
        {finished ? "" : "Spinning…"}
      </p>

      {/* Pointer triangle */}
      <div style={{
        width: 0, height: 0,
        borderLeft: "10px solid transparent",
        borderRight: "10px solid transparent",
        borderBottom: "18px solid white",
        marginBottom: -2,
        position: "relative",
        zIndex: 1,
      }} />

      {/* Wheel — the entire SVG rotates; posters orbit the centre */}
      <motion.div animate={controls} style={{ transformOrigin: "center", width: SVG, height: SVG }}>
        <svg width={SVG} height={SVG} viewBox={`0 0 ${SVG} ${SVG}`}>
          {/* Faint guide ring */}
          <circle cx={cx} cy={cy} r={orbitR + posterH / 2 + 4}
            fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

          {sorted.map((match, i) => {
            const midAngle = i * segAngle + segAngle / 2;
            const pos = polarToCartesian(cx, cy, orbitR, midAngle);
            const src = match.film?.poster_path
              ? posterUrl(match.film.poster_path, "w342")
              : null;
            const isWinner = match.film_id === winnerId;

            return (
              <g key={match.film_id}>
                {/* Card background */}
                <rect
                  x={pos.x - posterW / 2}
                  y={pos.y - posterH / 2}
                  width={posterW}
                  height={posterH}
                  rx={cornerR}
                  ry={cornerR}
                  fill="#1a1a1a"
                  stroke={finished && isWinner ? "#ffffff" : "rgba(255,255,255,0.15)"}
                  strokeWidth={finished && isWinner ? 2 : 1}
                />

                {/* Poster image */}
                {src && (
                  <image
                    href={src}
                    x={pos.x - posterW / 2}
                    y={pos.y - posterH / 2}
                    width={posterW}
                    height={posterH}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#card-clip-${i})`}
                  />
                )}

                {/* ClipPath matching the rounded rect */}
                <defs>
                  <clipPath id={`card-clip-${i}`}>
                    <rect
                      x={pos.x - posterW / 2}
                      y={pos.y - posterH / 2}
                      width={posterW}
                      height={posterH}
                      rx={cornerR}
                      ry={cornerR}
                    />
                  </clipPath>
                </defs>
              </g>
            );
          })}

          {/* Centre cap */}
          <circle cx={cx} cy={cy} r={14} fill="#0c0c0e" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
        </svg>
      </motion.div>

      {finished && winnerFilm && (
        <p className="text-xl font-bold mt-6 text-center px-8" style={{ color: "var(--text)" }}>
          {winnerFilm.title}
        </p>
      )}
    </div>
  );
}
