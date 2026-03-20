import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: "#0c0c0e",
          borderRadius: 7,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Camera body */}
        <div
          style={{
            width: 22,
            height: 16,
            border: "1.5px solid #e8b86d",
            borderRadius: 3,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
          }}
        >
          {/* Lens outer */}
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              border: "1.5px solid #e8b86d",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Lens inner */}
            <div
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "#e8b86d",
                opacity: 0.7,
              }}
            />
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
