// Dendy Cinemas logo — white via CSS invert (logo source is black on transparent)
export default function DendyLogo({ height = 13 }: { height?: number }) {
  return (
    <img
      src="/dendy-logo.png"
      alt="Dendy Cinemas"
      style={{ height, filter: "invert(1)", opacity: 0.85, display: "inline-block" }}
      draggable={false}
    />
  );
}
