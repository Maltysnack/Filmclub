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
  const cx = SVG / 2;       // 150 — wheel hub x
  const cy = SVG / 2;       // 150 — wheel hub y
  const orbitR = 95;

  const maxArcWidth = 2 * orbitR * Math.sin(Math.PI / n) * 0.78;
  const posterW = Math.min(68, maxArcWidth);
  const posterH = posterW * 1.5;
  const cornerR = posterW * 0.1;

  // The top poster's centre in SVG space:
  //   x = cx = 150  (horizontally centred)
  //   y = cy - orbitR = 55  (above the hub)
  const topPosterY = cy - orbitR; // 55

  // Target: the top poster always appears ~140px wide on screen.
  const targetPosterPx = 140;
  const scale = Math.max(1, targetPosterPx / posterW);

  // On-screen poster height is always targetPosterPx * 1.5 (= 210px) when scale > 1,
  // because posterH_screen = posterW_svgu * 1.5 * scale = (targetPosterPx/scale) * 1.5 * scale.
  const screenPosterH = Math.max(posterH, targetPosterPx * 1.5);

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
    // overflow:hidden on the outermost fixed layer is what clips the wheel
    <div className="fixed inset-0 z-50" style={{ background: "rgba(0,0,0,0.92)", overflow: "hidden" }}>

      {/* Status text — top of screen */}
      <p
        className="absolute top-10 left-0 right-0 text-center text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        {finished ? "" : "Spinning…"}
      </p>

      {/* Pointer triangle — pinned just above screen centre */}
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
        - positioned so SVG point (cx, topPosterY) = (150, 55) lands at screen centre
          via: left = calc(50% - 150px), top = calc(50% - 55px)
        - scaled around that same point via transformOrigin: "150px 55px"
        Result: the top poster is always dead-centre on screen at any scale.
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
                <g key={match.film_id} transform={`rotate(${midAngle}, ${pos.x}, ${pos.y})`}>
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

      {/* Winner title — bottom of screen */}
      {finished && winnerFilm && (
        <p
          className="absolute left-0 right-0 text-xl font-bold text-center px-8"
          style={{ color: "var(--text)", bottom: "12vh" }}
        >
          {winnerFilm.title}
        </p>
      )}
    </div>
  );
}
