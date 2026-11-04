// A stack of two poster cards, the top one mid-swipe, with one red frame marker.
export function LogoMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect x="5.5" y="6.5" width="15" height="22" fill="none" stroke="#fff" strokeWidth="2" />
      <rect x="12" y="2" width="15" height="22" fill="#fff" transform="rotate(10 19.5 13)" />
      <rect x="18.500" y="6" width="5" height="5" fill="var(--red, #e10600)" transform="rotate(10 19.5 13)" />
    </svg>
  );
}

export default function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  const large = size === "lg";
  return (
    <span className="flex items-center gap-2 sm:gap-3">
      <LogoMark className={large ? "size-11 sm:size-14" : "size-6"} />
      <span className={`display ${large ? "text-[38px] sm:text-[52px]" : "text-[15px]"}`}>Filmclub</span>
    </span>
  );
}
