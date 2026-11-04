import { motion } from "framer-motion";

const CROSS = "M12 12 L88 88 M88 12 L12 88";
const TICK = "M8 56 L36 86 L94 12";

// Keyline underneath so the mark reads on any poster, and the shape alone carries the meaning.
export default function Mark({ kind, className }: { kind: "cross" | "tick"; className?: string }) {
  const d = kind === "cross" ? CROSS : TICK;
  const draw = { initial: { pathLength: 0 }, animate: { pathLength: 1 }, transition: { duration: 0.18, ease: "linear" as const } };
  return (
    <svg viewBox="0 0 100 100" fill="none" strokeLinecap="square" aria-hidden="true" className={className}>
      <motion.path d={d} stroke="#000" strokeWidth={17} {...draw} />
      <motion.path d={d} stroke={kind === "cross" ? "var(--red)" : "var(--green)"} strokeWidth={12} {...draw} />
    </svg>
  );
}
