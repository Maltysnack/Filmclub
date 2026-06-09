import Link from "next/link";

// Lightweight chrome for the /watch content pages: brand header + centered
// content column + footer. The swipe app has its own standalone UI, so these
// pages get their own simple frame.
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header
        style={{ borderBottom: "1px solid var(--border)" }}
        className="w-full"
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link
            href="/"
            className="text-lg font-bold tracking-tight"
            style={{ color: "var(--accent)" }}
          >
            Filmclub
          </Link>
          <Link
            href="/"
            className="rounded-full px-4 py-1.5 text-sm font-semibold"
            style={{ background: "var(--accent)", color: "#0c0c0e" }}
          >
            Start a session
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">{children}</main>

      <footer
        style={{ borderTop: "1px solid var(--border)", color: "var(--text-muted)" }}
        className="w-full"
      >
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-6 text-sm">
          <Link href="/" style={{ color: "var(--text-muted)" }}>
            Home
          </Link>
          <Link href="/watch" style={{ color: "var(--text-muted)" }}>
            What to watch
          </Link>
          <span>Film data from TMDB. Ratings from IMDb via OMDb.</span>
        </div>
      </footer>
    </>
  );
}
