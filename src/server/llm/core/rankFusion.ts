/**
 * Reciprocal rank fusion — merge a vector ranking and a keyword ranking.
 *
 * Search used to run the vector query and fall back to keywords only when it
 * returned nothing. Nearest-neighbour search always returns *something* once a
 * single row has an embedding, so the fallback effectively never ran: a row
 * still waiting for its embedding was unfindable even by its exact title, and a
 * query for a literal term ("INV-2291") got the semantically closest rows
 * instead of the one containing it.
 *
 * RRF scores each item by 1 / (k + rank) in every list it appears in and sums.
 * It needs no score normalisation — cosine distance and `ts_rank` are not on
 * comparable scales, and RRF only uses positions — and an item that appears in
 * both lists rises above one that appears in either alone. k = 60 is the value
 * from the original paper (Cormack et al., 2009) and the common default.
 *
 * Pure on purpose, so it is testable without a database.
 */

const K = 60;

/**
 * Merge ranked lists into one, best first, deduplicated by `keyOf`.
 *
 * When an item appears in several lists, the first list's copy is the one
 * returned — pass the list whose row shape you prefer first.
 */
export function fuseRankings<T>(
  lists: readonly (readonly T[])[],
  keyOf: (item: T) => string | number,
  limit: number,
): T[] {
  const scored = new Map<string | number, { item: T; score: number; firstSeen: number }>();
  let order = 0;

  for (const list of lists) {
    list.forEach((item, rank) => {
      const key = keyOf(item);
      const contribution = 1 / (K + rank + 1);
      const entry = scored.get(key);
      if (entry) entry.score += contribution;
      else scored.set(key, { item, score: contribution, firstSeen: order++ });
    });
  }

  return [...scored.values()]
    // Ties (same rank in different lists) keep the order the lists were given in.
    .sort((a, b) => b.score - a.score || a.firstSeen - b.firstSeen)
    .slice(0, limit)
    .map((e) => e.item);
}
