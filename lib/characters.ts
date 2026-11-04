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

// Same story while there's room, then a random character from any other story.
export function nextName(setName: string, taken: string[], random = Math.random): string {
  const free = (names: string[]) => names.filter((n) => !taken.includes(n));
  const own = free(CHARACTER_SETS[setName] ?? []);
  const pool = own.length ? own : free(Object.values(CHARACTER_SETS).flat());
  return pool.length ? pool[Math.floor(random() * pool.length)] : `Extra ${taken.length + 1}`;
}
