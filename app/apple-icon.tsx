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
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Viewfinder bump + camera body as one column */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          {/* Viewfinder */}
          <div
            style={{
              width: 44,
              height: 14,
              border: "3px solid #e8b86d",
              borderBottom: "none",
              borderRadius: "5px 5px 0 0",
              marginBottom: -2,
            }}
          />
          {/* Camera body — fills most of the icon */}
          <div
            style={{
              width: 140,
              height: 96,
              border: "3px solid #e8b86d",
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              paddingLeft: 18,
              position: "relative",
            }}
          >
            {/* Lens outer ring */}
            <div
              style={{
                width: 62,
                height: 62,
                borderRadius: "50%",
                border: "3px solid #e8b86d",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {/* Lens inner ring */}
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
                {/* Reflection dot */}
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "#e8b86d",
                    opacity: 0.55,
                  }}
                />
              </div>
            </div>

            {/* Bellows lines */}
            <div
              style={{
                position: "absolute",
                right: 16,
                top: 14,
                bottom: 14,
                display: "flex",
                gap: 5,
                alignItems: "stretch",
              }}
            >
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 2,
                    background: "#e8b86d",
                    opacity: 0.45,
                    borderRadius: 2,
                  }}
                />
              ))}
            </div>

            {/* Shutter button top-right */}
            <div
              style={{
                position: "absolute",
                top: -8,
                right: 20,
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#e8b86d",
                opacity: 0.8,
              }}
            />
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
