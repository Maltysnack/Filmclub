import { ImageResponse } from "next/og";

// Branded 1200x630 share card. Renders for every link to the site root, so a
// shared join link shows a real preview instead of a naked URL.
export const alt =
  "Filmclub: swipe with friends and match on one film everyone wants to watch";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#0c0c0e",
          padding: "72px 80px",
        }}
      >
        {/* brand row: camera logo (scaled from app/icon.tsx) + wordmark */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: 110,
              height: 80,
              border: "6px solid #e8b86d",
              borderRadius: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: "50%",
                border: "6px solid #e8b86d",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  backgroundColor: "#e8b86d",
                  opacity: 0.7,
                  display: "flex",
                }}
              />
            </div>
          </div>
          <div style={{ marginLeft: 28, fontSize: 64, fontWeight: 700, color: "#e8b86d" }}>
            Filmclub
          </div>
        </div>

        {/* headline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 72, fontWeight: 800, color: "#f0ede8", lineHeight: 1.05 }}>
            {"Can't agree on a movie?"}
          </div>
          <div
            style={{
              fontSize: 38,
              color: "#9898a6",
              marginTop: 28,
              maxWidth: 960,
              lineHeight: 1.3,
            }}
          >
            Swipe with your friends and match on one film everyone wants to watch.
          </div>
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 32, fontWeight: 600, color: "#e8b86d" }}>filmclub.watch</div>
          <div style={{ fontSize: 28, color: "#9898a6" }}>No login · Free</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
