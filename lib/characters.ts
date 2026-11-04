// Every lobby is drawn from one shared story. A big group overflows into the next set.
export const CHARACTER_SETS: Record<string, string[]> = {
  "The Fellowship": ["Frodo", "Samwise", "Merry", "Pippin", "Gandalf", "Aragorn", "Legolas", "Gimli", "Boromir", "Gollum"],
  "The Avengers": ["Tony Stark", "Spider-Man", "Thor", "Black Widow", "Captain America", "Thanos", "Wolverine", "Deadpool", "Black Panther"],
  "The Rebellion": ["Luke Skywalker", "Darth Vader", "Han Solo", "Yoda", "Leia Organa", "Obi-Wan Kenobi"],
  "Hogwarts": ["Harry Potter", "Hermione", "Ron Weasley", "Dumbledore", "Dobby"],
};

export const SET_NAMES = Object.keys(CHARACTER_SETS);

export function randomSet(random = Math.random): string {
  return SET_NAMES[Math.floor(random() * SET_NAMES.length)];
}

export function nextName(setName: string, taken: string[], random = Math.random): string {
  const start = Math.max(SET_NAMES.indexOf(setName), 0);
  for (let i = 0; i < SET_NAMES.length; i++) {
    const free = CHARACTER_SETS[SET_NAMES[(start + i) % SET_NAMES.length]].filter((n) => !taken.includes(n));
    if (free.length) return free[Math.floor(random() * free.length)];
  }
  return `Extra ${taken.length + 1}`;
}
