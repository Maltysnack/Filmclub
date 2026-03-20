interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
}

export default function Logo({ size = "md", showText = true }: LogoProps) {
  const dims = { sm: 28, md: 40, lg: 56 };
  const textSizes = { sm: "text-lg", md: "text-2xl", lg: "text-4xl" };
  const gaps = { sm: "gap-2", md: "gap-3", lg: "gap-4" };
  const d = dims[size];

  return (
    <div className={`flex items-center ${gaps[size]}`}>
      {/* Bellows camera SVG */}
      <svg
        width={d}
        height={d}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Camera body */}
        <rect x="4" y="14" width="40" height="26" rx="3" fill="#1c1c20" stroke="#e8b86d" strokeWidth="1.5" />

        {/* Viewfinder / top */}
        <rect x="14" y="8" width="16" height="7" rx="2" fill="#1c1c20" stroke="#e8b86d" strokeWidth="1.5" />

        {/* Lens outer ring */}
        <circle cx="22" cy="27" r="9" fill="#0c0c0e" stroke="#e8b86d" strokeWidth="1.5" />

        {/* Lens inner */}
        <circle cx="22" cy="27" r="5.5" fill="#141416" stroke="#e8b86d" strokeWidth="1" />

        {/* Lens reflection */}
        <circle cx="20" cy="25" r="1.5" fill="#e8b86d" opacity="0.4" />

        {/* Bellows accordion lines on right side */}
        <line x1="34" y1="18" x2="34" y2="36" stroke="#e8b86d" strokeWidth="1" opacity="0.5" />
        <line x1="37" y1="18" x2="37" y2="36" stroke="#e8b86d" strokeWidth="1" opacity="0.5" />
        <line x1="40" y1="18" x2="40" y2="36" stroke="#e8b86d" strokeWidth="1" opacity="0.5" />

        {/* Shutter button */}
        <circle cx="38" cy="12" r="3" fill="#e8b86d" opacity="0.8" />

        {/* Cloth drape hint — curved line below body */}
        <path
          d="M4 38 Q8 44 14 42 Q18 40 22 43 Q26 46 30 42 Q36 38 44 40"
          stroke="#e8b86d"
          strokeWidth="1.2"
          strokeLinecap="round"
          fill="none"
          opacity="0.55"
        />
      </svg>

      {showText && (
        <span
          className={`${textSizes[size]} font-light tracking-[0.15em] text-text uppercase`}
          style={{ letterSpacing: "0.15em" }}
        >
          Filmclub
        </span>
      )}
    </div>
  );
}
