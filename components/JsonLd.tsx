// Renders a JSON-LD <script>. Content is always a static object we build
// server-side (never user input), so it is safe to serialize directly.
export function JsonLd({ data }: { data: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
