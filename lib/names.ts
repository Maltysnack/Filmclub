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

// Hand-picked brand colours — one per character, chosen to be iconic and distinct
export const CHARACTER_COLORS: Record<string, string> = {
  // Star Wars
  "Luke Skywalker":   "#38bdf8", // sky blue (lightsaber / hope)
  "Darth Vader":      "#dc2626", // sith red
  "Han Solo":         "#7b8fcf", // slate blue (Millennium Falcon)
  "Yoda":             "#84cc16", // yellow-green (same concept as Shrek → conflict group)
  "Leia Organa":      "#c084fc", // soft lavender (royalty / Force)
  "Obi-Wan Kenobi":   "#60a5fa", // calm blue (wisdom)
  // Lord of the Rings
  "Frodo":            "#92400e", // earthy hobbit brown
  "Gandalf":          "#d1d5db", // silver-grey (Gandalf the Grey)
  "Aragorn":          "#64748b", // steel blue-grey
  "Legolas":          "#a3e635", // bright leaf-green (elven)
  "Gollum":           "#a8a29e", // pale stone-grey
  "Samwise":          "#65a30d", // earthy mid-green
  // Harry Potter
  "Harry Potter":     "#6366f1", // indigo (magic / lightning bolt)
  "Hermione":         "#e11d48", // Gryffindor rose-red
  "Ron Weasley":      "#ea580c", // Weasley orange
  "Dumbledore":       "#7c3aed", // deep wizard purple
  // Marvel
  "Tony Stark":       "#f43f5e", // Iron Man red (suit)
  "Spider-Man":       "#ef4444", // bright red (mask)
  "Thor":             "#2563eb", // electric blue (lightning)
  "Black Widow":      "#be123c", // dark crimson
  "Captain America":  "#1d4ed8", // shield navy
  "Thanos":           "#a855f7", // infinity-gauntlet purple (lighter than Dumbledore)
  // Disney / Pixar
  "Simba":            "#f47c7c", // savanna sunset red
  "Buzz Lightyear":   "#312e81", // deep space indigo
  "Woody":            "#f97316", // cowboy orange-amber
  "Elsa":             "#bae6fd", // ice blue
  "Moana":            "#0891b2", // ocean cyan
  "Dory":             "#1e40af", // deep ocean blue
  // Classics
  "Indiana Jones":    "#6aaf7a", // jungle green
  "James Bond":       "#94a3b8", // silver (tuxedo / spy)
  "Jack Sparrow":     "#5a8ab8", // deep sea blue
  "The Terminator":   "#a1a1aa", // metallic chrome
  "Forrest Gump":     "#5bbfb5", // muted teal
  "Katniss Everdeen": "#166534", // forest green
  "Neo":              "#22c55e", // matrix green
  "Morpheus":         "#581c87", // very deep purple
  "Shrek":            "#16a34a", // ogre green
  "Batman":           "#818cf8", // indigo-400 (dark knight, readable)
  "The Joker":        "#9333ea", // vibrant purple
  "Jack Dawson":      "#0369a1", // Titanic ocean blue
};

// Characters that share the same strong colour identity — only one per group
// can be in a session at a time. Picked when it's obvious two names mean
// "the same colour" rather than just a similar hue.
export const COLOR_GROUPS: string[][] = [
  ["Shrek", "Yoda"],               // both are famous for BEING green
  ["Dumbledore", "Morpheus"],      // both deep, near-identical purple
];

// Pick a mystery name that isn't taken AND doesn't clash with a taken colour group
export function pickMysteryName(takenNames: string[]): string {
  // Collect all names excluded by already-taken colour groups
  const blockedByGroup = new Set<string>(
    COLOR_GROUPS
      .filter(group => group.some(n => takenNames.includes(n)))
      .flat()
  );

  const available = PLAYER_NAMES.filter(
    n => !takenNames.includes(n) && !blockedByGroup.has(n)
  );

  // Fallback 1: ignore group restrictions (all names in the groups might be taken)
  const fallback1 = PLAYER_NAMES.filter(n => !takenNames.includes(n));

  // Fallback 2: allow any name at all (pool exhausted)
  const pool = available.length > 0 ? available
    : fallback1.length > 0 ? fallback1
    : PLAYER_NAMES;

  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Colour lightness enforcement ──────────────────────────────────────────────
// On a near-black background, colours below ~55% HSL lightness become hard to
// read or look like inactive/disabled states. These helpers clamp any hex
// colour up to the minimum without changing its hue or saturation.

const MIN_LIGHTNESS = 0.55;

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  let r = ((n >> 16) & 255) / 255;
  let g = ((n >> 8) & 255) / 255;
  let b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function ensureMinLightness(hex: string): string {
  const [h, s, l] = hexToHsl(hex);
  return l >= MIN_LIGHTNESS ? hex : hslToHex(h, s, MIN_LIGHTNESS);
}

export function participantColor(name: string): string {
  // Hardcoded overrides for special nicknames
  if (name === "Red Rebel")   return ensureMinLightness("#ef4444");
  if (name === "Blue Bandit") return ensureMinLightness("#3b82f6");

  // Use the brand colour for any known character (clamped to min lightness)
  if (CHARACTER_COLORS[name]) return ensureMinLightness(CHARACTER_COLORS[name]);

  // Fallback: hash name to a hue via golden ratio (handles custom names)
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = name.charCodeAt(i) + ((h << 5) - h);
    h |= 0;
  }
  const hue = ((Math.abs(h) * 0.618033988749895) % 1) * 360;
  // l = 0.62 already clears the threshold, but ensureMinLightness is applied
  // for safety so any future changes to the fallback are automatically covered.
  const s = 0.68, l = 0.62;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return ensureMinLightness(`#${f(0)}${f(8)}${f(4)}`);
}
