/** Max processed SHAs to retain across detector and store. */
export const MAX_PROCESSED = 1000;

/**
 * Evict oldest entries from a Set to keep it within a size cap.
 * Preserves the most recent entries (Set iteration order is insertion order).
 */
export function evictOldest(set: Set<string>, maxSize: number): void {
  if (set.size <= maxSize) return;
  const entries = [...set];
  const toRemove = entries.slice(0, entries.length - maxSize);
  for (const item of toRemove) {
    set.delete(item);
  }
}
