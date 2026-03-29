// ── Character → Film lookup ────────────────────────────────────────────────────
// Every name in MYSTERY_NAMES maps to its source film.
// Multiple characters can share the same TMDB ID (same film).
// Add new entries here — MYSTERY_NAMES is derived automatically.

export const CHARACTER_FILMS: Record<string, { title: string; tmdbId: number }> = {
  // ── Cult / prestige ────────────────────────────────────────────────────────
  "Tyler Durden":          { title: "Fight Club",                    tmdbId: 550     },
  "Mia Wallace":           { title: "Pulp Fiction",                  tmdbId: 680     },
  "Jack Torrance":         { title: "The Shining",                   tmdbId: 694     },
  "Anton Chigurh":         { title: "No Country for Old Men",        tmdbId: 6479    },
  "Hannibal Lecter":       { title: "The Silence of the Lambs",      tmdbId: 274     },
  "Ellen Ripley":          { title: "Alien",                         tmdbId: 348     },
  "Patrick Bateman":       { title: "American Psycho",               tmdbId: 1359    },
  "Travis Bickle":         { title: "Taxi Driver",                   tmdbId: 703     },
  "Amy Dunne":             { title: "Gone Girl",                     tmdbId: 210577  },
  "Keyser Söze":           { title: "The Usual Suspects",            tmdbId: 629     },
  "Frank Costello":        { title: "The Departed",                  tmdbId: 1422    },
  "Holly Golightly":       { title: "Breakfast at Tiffany's",        tmdbId: 3165    },
  "Alex DeLarge":          { title: "A Clockwork Orange",            tmdbId: 185     },
  "Roy Batty":             { title: "Blade Runner",                  tmdbId: 78      },
  "Norman Bates":          { title: "Psycho",                        tmdbId: 539     },
  "Beatrix Kiddo":         { title: "Kill Bill: Vol. 1",             tmdbId: 24      },
  "The Dude":              { title: "The Big Lebowski",              tmdbId: 115     },
  "Chiron":                { title: "Moonlight",                     tmdbId: 376867  },
  "J. Robert Oppenheimer": { title: "Oppenheimer",                   tmdbId: 872585  },

  // ── Blockbuster icons ──────────────────────────────────────────────────────
  "Darth Vader":           { title: "Star Wars: A New Hope",         tmdbId: 11      },
  "Luke Skywalker":        { title: "Star Wars: A New Hope",         tmdbId: 11      },
  "Indiana Jones":         { title: "Raiders of the Lost Ark",       tmdbId: 85      },
  "Sam Witwicky":          { title: "Transformers",                  tmdbId: 1858    },
  "Optimus Prime":         { title: "Transformers",                  tmdbId: 1858    },
  "Aragorn":               { title: "The Fellowship of the Ring",    tmdbId: 120     },
  "Frodo":                 { title: "The Fellowship of the Ring",    tmdbId: 120     },
  "Fantastic Mr. Fox":     { title: "Fantastic Mr. Fox",             tmdbId: 10315   },
  "James Bond":            { title: "Casino Royale",                 tmdbId: 36557   },
  "John Wick":             { title: "John Wick",                     tmdbId: 245891  },
  "Ethan Hunt":            { title: "Mission: Impossible",           tmdbId: 954     },
  "Jason Bourne":          { title: "The Bourne Identity",           tmdbId: 2501    },
};

export const MYSTERY_NAMES = Object.keys(CHARACTER_FILMS);
