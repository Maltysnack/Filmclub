import { ImageResponse } from "next/og";

export const alt = "Filmclub. Swipe together. Pick one film.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", background: "#000", color: "#fff", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 72 }}>
      <div style={{ width: 90, height: 120, position: "relative", display: "flex", marginBottom: 32 }}>
        <div style={{ position: "absolute", left: 0, top: 22, width: 62, height: 90, border: "6px solid #fff" }} />
        <div style={{ position: "absolute", left: 28, top: 0, width: 62, height: 92, background: "#fff", transform: "rotate(10deg)", display: "flex" }}>
          <div style={{ margin: "12px 0 0 34px", width: 20, height: 20, background: "#e10600" }} />
        </div>
      </div>
      <div style={{ fontSize: 132, fontWeight: 800, letterSpacing: -2 }}>FILMCLUB</div>
      <div style={{ fontSize: 34, marginTop: 12 }}>Swipe together. Pick one film.</div>
    </div>,
    size,
  );
}
