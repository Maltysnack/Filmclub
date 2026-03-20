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
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        {/* Viewfinder bump on top of camera */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
          <div
            style={{
              width: 36,
              height: 10,
              border: "2.5px solid #e8b86d",
              borderBottom: "none",
              borderRadius: "4px 4px 0 0",
              marginBottom: -1,
            }}
          />
          {/* Camera body */}
          <div
            style={{
              width: 90,
              height: 60,
              border: "2.5px solid #e8b86d",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              paddingLeft: 14,
              gap: 0,
              position: "relative",
            }}
          >
            {/* Lens outer ring */}
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: "50%",
                border: "2.5px solid #e8b86d",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* Lens inner ring */}
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  border: "2px solid #e8b86d",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {/* Lens reflection dot */}
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "#e8b86d",
                    opacity: 0.6,
                  }}
                />
              </div>
            </div>

            {/* Bellows lines on right */}
            <div
              style={{
                position: "absolute",
                right: 10,
                top: 10,
                bottom: 10,
                display: "flex",
                gap: 4,
                alignItems: "stretch",
              }}
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 1.5,
                    background: "#e8b86d",
                    opacity: 0.5,
                    borderRadius: 1,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Wordmark */}
        <div
          style={{
            color: "#f0ede8",
            fontSize: 20,
            fontWeight: 300,
            letterSpacing: "0.2em",
          }}
        >
          FILMCLUB
        </div>
      </div>
    ),
    { ...size }
  );
}
