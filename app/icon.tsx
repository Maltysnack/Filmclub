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
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Simple lens circle — clean at small sizes */}
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            border: "2.5px solid #e8b86d",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
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
    ),
    { ...size }
  );
}
