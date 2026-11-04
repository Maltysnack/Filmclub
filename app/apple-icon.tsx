import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: 180, height: 180, background: "#000", display: "flex", position: "relative" }}>
      <div style={{ position: "absolute", left: 38, top: 50, width: 76, height: 108, border: "9px solid #fff" }} />
      <div style={{ position: "absolute", left: 70, top: 22, width: 78, height: 112, background: "#fff", transform: "rotate(10deg)", display: "flex" }}>
        <div style={{ margin: "16px 0 0 42px", width: 26, height: 26, background: "#e10600" }} />
      </div>
    </div>,
    size,
  );
}
