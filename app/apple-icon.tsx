import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 180,
          height: 180,
          background: "#0c0c0e",
          borderRadius: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
        }}
      >
        {/* Camera body */}
        <div
          style={{
            width: 100,
            height: 70,
            border: "3px solid #e8b86d",
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {/* Lens */}
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: "3px solid #e8b86d",
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
                background: "#e8b86d",
                opacity: 0.5,
              }}
            />
          </div>
        </div>
        {/* Wordmark */}
        <div
          style={{
            color: "#f0ede8",
            fontSize: 22,
            fontWeight: 300,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
          }}
        >
          FILMCLUB
        </div>
      </div>
    ),
    { ...size }
  );
}
