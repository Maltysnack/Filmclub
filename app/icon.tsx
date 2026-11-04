import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{ width: 32, height: 32, background: "#000", display: "flex", position: "relative" }}>
      <div style={{ position: "absolute", left: 6, top: 8, width: 14, height: 20, border: "2px solid #fff" }} />
      <div style={{ position: "absolute", left: 12, top: 3, width: 15, height: 21, background: "#fff", transform: "rotate(10deg)", display: "flex" }}>
        <div style={{ margin: "3px 0 0 8px", width: 5, height: 5, background: "#e10600" }} />
      </div>
    </div>,
    size,
  );
}
