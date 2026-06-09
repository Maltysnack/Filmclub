import Link from "next/link";

// Funnels content-page readers into the core app. Points at the home form
// (deep-link prefill of region/services is a separate, app-touching change).
export function StartCta({ serviceName }: { serviceName?: string }) {
  return (
    <Link
      href="/"
      className="my-8 flex items-center justify-between gap-4 rounded-2xl p-5 no-underline"
      style={{ background: "var(--accent)", color: "#0c0c0e" }}
    >
      <div className="flex flex-col">
        <strong className="text-lg font-bold">{"Can't agree on a film?"}</strong>
        <span className="text-sm opacity-90">
          Start a Filmclub{serviceName ? `, add ${serviceName},` : ""} and everyone swipes
          until you match on one. No login, free.
        </span>
      </div>
      <span aria-hidden="true" className="text-2xl font-bold">
        →
      </span>
    </Link>
  );
}
