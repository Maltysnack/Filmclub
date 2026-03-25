const PERSON_COLORS = ["#22c55e","#a855f7","#f97316","#06b6d4","#ec4899","#eab308","#6366f1","#14b8a6"];

export function participantColor(name: string): string {
  if (name === "Red Rebel") return "#ef4444";
  if (name === "Blue Bandit") return "#3b82f6";
  let h = 0;
  for (let i = 0; i < name.length; i++) { h = name.charCodeAt(i) + ((h << 5) - h); h |= 0; }
  return PERSON_COLORS[Math.abs(h) % PERSON_COLORS.length];
}
