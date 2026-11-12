/**
 * Fuzzy matching for the palette: every character of the query must appear in
 * order. Runs of adjacent matches and matches at the start of a word score
 * higher, so "uc" finds "User.count()" before "public function".
 */
export function fuzzyScore(query: string, text: string): number {
  const needle = query.trim().toLowerCase()
  if (!needle)
    return 1
  const haystack = text.toLowerCase()
  let score = 0
  let at = 0
  let run = 0
  for (const char of needle) {
    if (char === ' ')
      continue
    const found = haystack.indexOf(char, at)
    if (found === -1)
      return 0
    run = found === at ? run + 1 : 1
    const startsWord = found === 0 || /[^a-z0-9]/.test(haystack[found - 1] ?? '')
    score += 1 + run * 2 + (startsWord ? 4 : 0)
    at = found + 1
  }
  // A shorter text that matches is a closer match.
  return score + Math.max(0, 20 - haystack.length / 8)
}

export function fuzzyFilter<T>(query: string, items: T[], text: (item: T) => string): T[] {
  if (!query.trim())
    return items
  return items
    .map(item => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map(entry => entry.item)
}
