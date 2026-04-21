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
  "Han Solo":         "#a16207", // leather amber
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
  "Tony Stark":       "#f59e0b", // gold (Iron Man)
  "Spider-Man":       "#ef4444", // bright red (mask)
  "Thor":             "#2563eb", // electric blue (lightning)
  "Black Widow":      "#be123c", // dark crimson
  "Captain America":  "#1d4ed8", // shield navy
  "Thanos":           "#a855f7", // infinity-gauntlet purple (lighter than Dumbledore)
  // Disney / Pixar
  "Simba":            "#fbbf24", // golden lion
  "Buzz Lightyear":   "#312e81", // deep space indigo
  "Woody":            "#f97316", // cowboy orange-amber
  "Elsa":             "#bae6fd", // ice blue
  "Moana":            "#0891b2", // ocean cyan
  "Dory":             "#1e40af", // deep ocean blue
  // Classics
  "Indiana Jones":    "#d97706", // warm sand amber
  "James Bond":       "#374151", // dark suit grey
  "Jack Sparrow":     "#44403c", // weathered dark brown
  "The Terminator":   "#52525b", // metallic charcoal
  "Forrest Gump":     "#d4a76a", // warm khaki
  "Katniss Everdeen": "#166534", // forest green
  "Neo":              "#22c55e", // matrix green
  "Morpheus":         "#581c87", // very deep purple
  "Shrek":            "#16a34a", // ogre green
  "Batman":           "#1e1b4b", // near-black dark indigo
  "The Joker":        "#9333ea", // vibrant purple
  "Jack Dawson":      "#0369a1", // Titanic ocean blue
};

// Characters that share the same strong colour identity — only one per group
// can be in a session at a time. Picked when it's obvious two names mean
// "the same colour" rather than just a similar hue.
export const COLOR_GROUPS: string[][] = [
  ["Shrek", "Yoda"],               // both are famous for BEING green
  ["Dumbledore", "Morpheus"],      // both deep, near-identical purple
  ["Han Solo", "Indiana Jones"],   // both warm amber-brown adventurers
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

export function participantColor(name: string): string {
  // Hardcoded overrides for special nicknames
  if (name === "Red Rebel")   return "#ef4444";
  if (name === "Blue Bandit") return "#3b82f6";

  // Use the brand colour for any known character
  if (CHARACTER_COLORS[name]) return CHARACTER_COLORS[name];

  // Fallback: hash name to a hue via golden ratio (handles custom names)
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = name.charCodeAt(i) + ((h << 5) - h);
    h |= 0;
  }
  const hue = ((Math.abs(h) * 0.618033988749895) % 1) * 360;
  // hslToHex inline
  const s = 0.68, l = 0.62;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
