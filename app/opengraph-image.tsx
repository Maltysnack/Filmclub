import { ImageResponse } from "next/og";

export const alt = "Filmclub. Swipe together. Pick one film.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", background: "#000", color: "#fff", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 72 }}>
      <div style={{ width: 64, height: 10, background: "#e10600", marginBottom: 28 }} />
      <div style={{ fontSize: 132, fontWeight: 800, letterSpacing: -2 }}>FILMCLUB</div>
      <div style={{ fontSize: 34, marginTop: 12 }}>Swipe together. Pick one film.</div>
    </div>,
    size,
  );
}
