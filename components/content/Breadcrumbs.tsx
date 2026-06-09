import Link from "next/link";
import { JsonLd } from "@/components/JsonLd";
import { SITE_URL } from "@/lib/site";

export type Crumb = { name: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.href ? { item: `${SITE_URL}${c.href}` } : {}),
    })),
  };

  return (
    <nav aria-label="Breadcrumb" className="mb-5 text-sm">
      <ol
        className="flex flex-wrap items-center gap-1.5"
        style={{ color: "var(--text-muted)", listStyle: "none", padding: 0, margin: 0 }}
      >
        {items.map((c, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {c.href ? (
              <Link href={c.href} style={{ color: "var(--text-muted)" }} className="hover:underline">
                {c.name}
              </Link>
            ) : (
              <span aria-current="page" style={{ color: "var(--text)" }}>
                {c.name}
              </span>
            )}
            {i < items.length - 1 && <span aria-hidden="true">/</span>}
          </li>
        ))}
      </ol>
      <JsonLd data={ld} />
    </nav>
  );
}
