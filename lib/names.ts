// Iconic film characters — recognisable at a glance, no explanation needed
export const PLAYER_NAMES = [
  // Star Wars
  "Luke Skywalker", "Darth Vader", "Han Solo", "Yoda", "Leia Organa", "Obi-Wan Kenobi",
  // Lord of the Rings
  "Frodo", "Gandalf", "Aragorn", "Legolas", "Gollum", "Samwise",
  // Harry Potter
  "Harry Potter", "Hermione", "Ron Weasley", "Dumbledore",
  // Marvel
  "Tony Stark", "Spider-Man", "Thor", "Black Widow", "Captain America", "Thanos",
  // Disney / Pixar
  "Simba", "Buzz Lightyear", "Woody", "Elsa", "Moana", "Dory",
  // Classics
  "Indiana Jones", "James Bond", "Jack Sparrow", "The Terminator",
  "Forrest Gump", "Katniss Everdeen", "Neo", "Morpheus",
  "Shrek", "Batman", "The Joker", "Jack Dawson",
];

// Convert HSL to a hex colour string so we can append CSS alpha suffixes like #rrggbb22
function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Golden ratio conjugate — multiplying by this and taking mod 1 spreads any sequence
// of integers evenly across [0,1], giving well-distributed hues even for many participants.
const GOLDEN = 0.618033988749895;

export function participantColor(name: string): string {
  // Hard-coded overrides for known nicknames
  if (name === "Red Rebel")  return "#ef4444";
  if (name === "Blue Bandit") return "#3b82f6";

  // Hash the name to an integer, then map to a hue via the golden ratio
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = name.charCodeAt(i) + ((h << 5) - h);
    h |= 0;
  }
  const hue = ((Math.abs(h) * GOLDEN) % 1) * 360;
  return hslToHex(hue, 68, 62);
}
