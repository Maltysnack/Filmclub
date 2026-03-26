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

  const sorted = [...films].sort((a, b) =>
    (a.film?.title ?? "").localeCompare(b.film?.title ?? "")
  );

  const n = sorted.length;
  const segAngle = 360 / n;
  const winnerIndex = sorted.findIndex((m) => m.film_id === winnerId);
  const winnerCenterAngle = winnerIndex * segAngle + segAngle / 2;
  const offsetToTop = (360 - winnerCenterAngle + 360) % 360;

  const fullSpins = 3 + (hashStr(winnerId) % 2);
  const totalRotation = fullSpins * 360 + offsetToTop;
  const overshootDeg = 20;

  const winnerFilm = sorted[winnerIndex]?.film;

  const SVG = 300;
  const cx = SVG / 2;
  const cy = SVG / 2;
  const orbitR = 95;
  const maxArcWidth = 2 * orbitR * Math.sin(Math.PI / n) * 0.78;
  const posterW = Math.min(68, maxArcWidth);
  const posterH = posterW * 1.5;
  const cornerR = posterW * 0.1;

  // Scale the wheel up continuously as n grows so the top poster always
  // appears at a readable size. Anchored at top-centre so the wheel grows
  // downward/outward — the hot seat stays pinned under the pointer.
  // At small n (≤~6) scale ≈ 1 (full wheel visible).
  // At large n the wheel is magnified and only the top arc shows through
  // the fixed-height clipping container.
  const targetPosterPx = 64;
  const scale = Math.max(1, targetPosterPx / posterW);

  // Container height: enough to show the winner poster clearly plus a bit
  // of context, regardless of scale. posterH in screen-px = posterH * scale.
  const containerHeight = Math.round(posterH * scale * 1.8 + 16);

  useEffect(() => {
    controls
      .start({
        rotate: [0, totalRotation + overshootDeg, totalRotation],
        transition: {
          duration: 12,
          times: [0, 0.88, 1.0],
          ease: [
            [0.3, 0.0, 0.8, 1.0],
            [0.0, 0.0, 0.4, 1.0],
          ],
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

      {/* Pointer — sits above the clipping window, always visible */}
      <div style={{
        width: 0, height: 0,
        borderLeft: "10px solid transparent",
        borderRight: "10px solid transparent",
        borderBottom: "18px solid white",
        marginBottom: -2,
        position: "relative",
        zIndex: 1,
      }} />

      {/* Clipping window — fixed height, clips sides and bottom as scale grows */}
      <div style={{ width: SVG, height: containerHeight, overflow: "hidden" }}>
        {/* Scale wrapper — anchored top-centre so wheel grows downward */}
        <div style={{ transform: `scale(${scale})`, transformOrigin: "50% 0%" }}>
          {/* Rotation — framer-motion spins around the wheel's own centre */}
          <motion.div animate={controls} style={{ transformOrigin: "center", width: SVG, height: SVG }}>
            <svg width={SVG} height={SVG} viewBox={`0 0 ${SVG} ${SVG}`}>
              {/* Guide ring */}
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
                  <g
                    key={match.film_id}
                    transform={`rotate(${midAngle}, ${pos.x}, ${pos.y})`}
                  >
                    <defs>
                      <clipPath id={`card-clip-${i}`}>
                        <rect
                          x={pos.x - posterW / 2} y={pos.y - posterH / 2}
                          width={posterW} height={posterH}
                          rx={cornerR} ry={cornerR}
                        />
                      </clipPath>
                    </defs>

                    <rect
                      x={pos.x - posterW / 2} y={pos.y - posterH / 2}
                      width={posterW} height={posterH}
                      rx={cornerR} ry={cornerR}
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

              <circle cx={cx} cy={cy} r={14} fill="#0c0c0e" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
            </svg>
          </motion.div>
        </div>
      </div>

      {finished && winnerFilm && (
        <p className="text-xl font-bold mt-6 text-center px-8" style={{ color: "var(--text)" }}>
          {winnerFilm.title}
        </p>
      )}
    </div>
  );
}
