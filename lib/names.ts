// Single source of truth for all participant character data.
// Each entry: the character's brand colour, their source film's TMDB ID, and film title.
// pickMysteryName / participantColor / getCharacterFilm all read from here.

export interface CharacterEntry {
  color: string;
  tmdbId: number;
  filmTitle: string;
}

export const CHARACTERS: Record<string, CharacterEntry> = {
  // ── Star Wars ────────────────────────────────────────────────────────────────
  "Luke Skywalker":   { color: "#38bdf8", tmdbId: 11,     filmTitle: "Star Wars: A New Hope" },
  "Darth Vader":      { color: "#dc2626", tmdbId: 11,     filmTitle: "Star Wars: A New Hope" },
  "Han Solo":         { color: "#7b8fcf", tmdbId: 11,     filmTitle: "Star Wars: A New Hope" },
  "Yoda":             { color: "#84cc16", tmdbId: 11,     filmTitle: "Star Wars: A New Hope" },
  "Leia Organa":      { color: "#c084fc", tmdbId: 11,     filmTitle: "Star Wars: A New Hope" },
  "Obi-Wan Kenobi":   { color: "#60a5fa", tmdbId: 11,     filmTitle: "Star Wars: A New Hope" },

  // ── Lord of the Rings ────────────────────────────────────────────────────────
  "Frodo":            { color: "#92400e", tmdbId: 120,    filmTitle: "The Lord of the Rings: The Fellowship of the Ring" },
  "Gandalf":          { color: "#d1d5db", tmdbId: 120,    filmTitle: "The Lord of the Rings: The Fellowship of the Ring" },
  "Aragorn":          { color: "#64748b", tmdbId: 120,    filmTitle: "The Lord of the Rings: The Fellowship of the Ring" },
  "Legolas":          { color: "#a3e635", tmdbId: 120,    filmTitle: "The Lord of the Rings: The Fellowship of the Ring" },
  "Gollum":           { color: "#a8a29e", tmdbId: 120,    filmTitle: "The Lord of the Rings: The Fellowship of the Ring" },
  "Samwise":          { color: "#65a30d", tmdbId: 120,    filmTitle: "The Lord of the Rings: The Fellowship of the Ring" },

  // ── Harry Potter ─────────────────────────────────────────────────────────────
  "Harry Potter":     { color: "#6366f1", tmdbId: 671,    filmTitle: "Harry Potter and the Philosopher's Stone" },
  "Hermione":         { color: "#e11d48", tmdbId: 671,    filmTitle: "Harry Potter and the Philosopher's Stone" },
  "Ron Weasley":      { color: "#ea580c", tmdbId: 671,    filmTitle: "Harry Potter and the Philosopher's Stone" },
  "Dumbledore":       { color: "#7c3aed", tmdbId: 671,    filmTitle: "Harry Potter and the Philosopher's Stone" },
  "Dobby":            { color: "#b0b7c3", tmdbId: 672,    filmTitle: "Harry Potter and the Chamber of Secrets" },

  // ── Marvel ────────────────────────────────────────────────────────────────────
  "Tony Stark":       { color: "#f43f5e", tmdbId: 1726,   filmTitle: "Iron Man" },
  "Spider-Man":       { color: "#ef4444", tmdbId: 557,    filmTitle: "Spider-Man" },
  "Thor":             { color: "#2563eb", tmdbId: 10195,  filmTitle: "Thor" },
  "Black Widow":      { color: "#be123c", tmdbId: 497698, filmTitle: "Black Widow" },
  "Captain America":  { color: "#1d4ed8", tmdbId: 1771,   filmTitle: "Captain America: The First Avenger" },
  "Thanos":           { color: "#a855f7", tmdbId: 299536, filmTitle: "Avengers: Infinity War" },
  "Wolverine":        { color: "#eab308", tmdbId: 36657,  filmTitle: "X-Men" },
  "Deadpool":         { color: "#991b1b", tmdbId: 293660, filmTitle: "Deadpool" },
  "Black Panther":    { color: "#8b5cf6", tmdbId: 284054, filmTitle: "Black Panther" },

  // ── Disney / Pixar ────────────────────────────────────────────────────────────
  "Simba":            { color: "#f47c7c", tmdbId: 8587,   filmTitle: "The Lion King" },
  "Buzz Lightyear":   { color: "#312e81", tmdbId: 862,    filmTitle: "Toy Story" },
  "Woody":            { color: "#f97316", tmdbId: 862,    filmTitle: "Toy Story" },
  "Elsa":             { color: "#bae6fd", tmdbId: 109445, filmTitle: "Frozen" },
  "Moana":            { color: "#0891b2", tmdbId: 277834, filmTitle: "Moana" },
  "Dory":             { color: "#1e40af", tmdbId: 12,     filmTitle: "Finding Nemo" },
  "Nemo":             { color: "#f4511e", tmdbId: 12,     filmTitle: "Finding Nemo" },
  "WALL·E":           { color: "#78350f", tmdbId: 10681,  filmTitle: "WALL·E" },
  "Groot":            { color: "#4ade80", tmdbId: 118340, filmTitle: "Guardians of the Galaxy" },
  "Rocket":           { color: "#b45309", tmdbId: 118340, filmTitle: "Guardians of the Galaxy" },
  "Gru":              { color: "#4338ca", tmdbId: 20352,  filmTitle: "Despicable Me" },
  "Po":               { color: "#fbbf24", tmdbId: 9502,   filmTitle: "Kung Fu Panda" },
  "Willy Wonka":      { color: "#d946ef", tmdbId: 252,    filmTitle: "Willy Wonka & the Chocolate Factory" },
  "Paddington":       { color: "#ca8a04", tmdbId: 27549,  filmTitle: "Paddington" },
  "E.T.":             { color: "#fb923c", tmdbId: 601,    filmTitle: "E.T. the Extra-Terrestrial" },
  "Fantastic Mr. Fox":{ color: "#d97706", tmdbId: 10315,  filmTitle: "Fantastic Mr. Fox" },

  // ── Blockbuster icons ─────────────────────────────────────────────────────────
  "Indiana Jones":    { color: "#6aaf7a", tmdbId: 85,     filmTitle: "Raiders of the Lost Ark" },
  "James Bond":       { color: "#94a3b8", tmdbId: 36557,  filmTitle: "Casino Royale" },
  "Jack Sparrow":     { color: "#5a8ab8", tmdbId: 22,     filmTitle: "Pirates of the Caribbean: The Curse of the Black Pearl" },
  "The Terminator":   { color: "#a1a1aa", tmdbId: 218,    filmTitle: "The Terminator" },
  "Forrest Gump":     { color: "#5bbfb5", tmdbId: 13,     filmTitle: "Forrest Gump" },
  "Katniss Everdeen": { color: "#166534", tmdbId: 70160,  filmTitle: "The Hunger Games" },
  "Neo":              { color: "#22c55e", tmdbId: 603,    filmTitle: "The Matrix" },
  "Morpheus":         { color: "#581c87", tmdbId: 603,    filmTitle: "The Matrix" },
  "Shrek":            { color: "#16a34a", tmdbId: 808,    filmTitle: "Shrek" },
  "Batman":           { color: "#818cf8", tmdbId: 272,    filmTitle: "Batman Begins" },
  "The Joker":        { color: "#9333ea", tmdbId: 475557, filmTitle: "Joker" },
  "Jack Dawson":      { color: "#0369a1", tmdbId: 597,    filmTitle: "Titanic" },
  "John Wick":        { color: "#475569", tmdbId: 245891, filmTitle: "John Wick" },
  "Ethan Hunt":       { color: "#0ea5e9", tmdbId: 954,    filmTitle: "Mission: Impossible" },
  "Jason Bourne":     { color: "#78716c", tmdbId: 2501,   filmTitle: "The Bourne Identity" },
  "Maverick":         { color: "#0284c7", tmdbId: 361743, filmTitle: "Top Gun: Maverick" },
  "Maximus":          { color: "#a16207", tmdbId: 98,     filmTitle: "Gladiator" },
  "Doc Brown":        { color: "#facc15", tmdbId: 105,    filmTitle: "Back to the Future" },
  "Marty McFly":      { color: "#c2410c", tmdbId: 105,    filmTitle: "Back to the Future" },
  "Jake Sully":       { color: "#06b6d4", tmdbId: 19995,  filmTitle: "Avatar" },
  "Optimus Prime":    { color: "#1e88e5", tmdbId: 1858,   filmTitle: "Transformers" },
  "Robocop":          { color: "#93c5fd", tmdbId: 5786,   filmTitle: "RoboCop" },
};

// Characters that share the same strong colour identity — only one per group
// can be in a session at a time.
export const COLOR_GROUPS: string[][] = [
  ["Shrek", "Yoda"],          // both famous for BEING green
  ["Dumbledore", "Morpheus"], // both deep, near-identical purple
];

// Pick a mystery name that isn't taken AND doesn't clash with a taken colour group
export function pickMysteryName(takenNames: string[]): string {
  const names = Object.keys(CHARACTERS);

  const blockedByGroup = new Set<string>(
    COLOR_GROUPS
      .filter(group => group.some(n => takenNames.includes(n)))
      .flat()
  );

  const available = names.filter(n => !takenNames.includes(n) && !blockedByGroup.has(n));
  const fallback1 = names.filter(n => !takenNames.includes(n));

  const pool = available.length > 0 ? available
    : fallback1.length > 0 ? fallback1
    : names;

  return pool[Math.floor(Math.random() * pool.length)];
}

// Returns the source film for a known character name, or null for custom names.
export function getCharacterFilm(name: string): { tmdbId: number; filmTitle: string } | null {
  const c = CHARACTERS[name];
  return c ? { tmdbId: c.tmdbId, filmTitle: c.filmTitle } : null;
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
  if (name === "Red Rebel")   return ensureMinLightness("#ef4444");
  if (name === "Blue Bandit") return ensureMinLightness("#3b82f6");

  if (CHARACTERS[name]) return ensureMinLightness(CHARACTERS[name].color);

  // Fallback: hash name to a hue via golden ratio (handles custom names)
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = name.charCodeAt(i) + ((h << 5) - h);
    h |= 0;
  }
  const hue = ((Math.abs(h) * 0.618033988749895) % 1) * 360;
  const s = 0.68, l = 0.62;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const c = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return ensureMinLightness(`#${f(0)}${f(8)}${f(4)}`);
}
