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

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const s = polarToCartesian(cx, cy, r, startAngle);
  const e = polarToCartesian(cx, cy, r, endAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
}

const COLORS = [
  "#22c55e", "#a855f7", "#f97316", "#06b6d4", "#ec4899",
  "#eab308", "#6366f1", "#14b8a6", "#ef4444", "#3b82f6",
];

export default function SpinWheel({ films, winnerId, onComplete }: SpinWheelProps) {
  const controls = useAnimation();
  const [finished, setFinished] = useState(false);
  const doneRef = useRef(false);

  const sorted = [...films].sort((a, b) =>
    (a.film?.title ?? "").localeCompare(b.film?.title ?? "")
  );

  const n = sorted.length;
  const segAngle = 360 / n;
  const winnerIndex = sorted.findIndex((m) => m.film_id === winnerId);
  const winnerCenter = winnerIndex * segAngle + segAngle / 2;
  const offsetToTop = (360 - winnerCenter + 360) % 360;
  const totalRotation = (6 + (hashStr(winnerId) % 5)) * 360 + offsetToTop;
  const winnerFilm = sorted[winnerIndex]?.film;

  useEffect(() => {
    controls
      .start({
        rotate: totalRotation,
        transition: {
          duration: 7,
          // Very slow start, builds to moderate speed, then long gentle wind-down.
          // x1=0.5 → handle halfway across means very little initial progress.
          // x2=0.85 → second handle far right means deceleration is spread over
          // the last ~40% of the animation — hard to perceive exactly when it stops.
          ease: [0.5, 0.0, 0.85, 1.0],
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
        borderLeft: "12px solid transparent",
        borderRight: "12px solid transparent",
        borderBottom: "22px solid white",
        marginBottom: -2,
        position: "relative",
        zIndex: 1,
      }} />

      {/* Wheel */}
      <motion.div
        animate={controls}
        style={{ transformOrigin: "center", width: 300, height: 300 }}
      >
        <svg width={300} height={300} viewBox="0 0 300 300">
          <defs>
            {sorted.map((_, i) => {
              const startAngle = i * segAngle;
              const endAngle = (i + 1) * segAngle;
              return (
                <clipPath key={i} id={`sw-clip-${i}`}>
                  <path d={describeArc(150, 150, 135, startAngle, endAngle)} />
                </clipPath>
              );
            })}
          </defs>

          {sorted.map((match, i) => {
            const startAngle = i * segAngle;
            const endAngle = (i + 1) * segAngle;
            const color = COLORS[i % COLORS.length];
            const src = match.film?.poster_path
              ? posterUrl(match.film.poster_path, "w342")
              : null;

            return (
              <g key={match.film_id}>
                {/* Coloured fallback (shows while image loads or if no poster) */}
                <path d={describeArc(150, 150, 135, startAngle, endAngle)}
                  fill={color} />

                {/* Poster image clipped to this segment */}
                {src && (
                  <image
                    href={src}
                    x={0} y={0} width={300} height={300}
                    preserveAspectRatio="xMidYMid slice"
                    clipPath={`url(#sw-clip-${i})`}
                  />
                )}

                {/* Segment border */}
                <path d={describeArc(150, 150, 135, startAngle, endAngle)}
                  fill="none" stroke="#0c0c0e" strokeWidth={1.5} />
              </g>
            );
          })}

          {/* Centre cap */}
          <circle cx={150} cy={150} r={18} fill="#0c0c0e" />
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
