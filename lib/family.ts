// TMDB splits franchises into several collections, Spider-Man into at least four.
// Name matching joins them into one family without a detail call per film.
const LEADING = /^(the|marvel'?s|disney'?s|dc'?s|amazing|ultimate|spectacular|superior|new|all new|tom clancy'?s)\s+/;
const TRAILING = /\s+(part\s+)?(\d+|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)$/;

export function familyKey(title: string): string {
  let key = title.toLowerCase().replace(/[’]/g, "'").split(/\s*[:–-]\s+|\s+and the\s+|\s+&\s+the\s+/)[0].trim();
  for (let prev = ""; prev !== key; ) {
    prev = key;
    key = key.replace(LEADING, "").replace(TRAILING, "").trim();
  }
  return key.replace(/[^a-z0-9]+/g, "");
}
