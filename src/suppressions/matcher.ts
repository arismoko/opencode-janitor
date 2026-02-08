import { fingerprint } from '../findings/fingerprint';
import type { Finding } from '../types';
import type { Suppression } from './types';

export type MatchResult =
  | { matched: false }
  | { matched: true; suppression: Suppression; tier: 'exact' | 'scoped' };

/** Check if a finding is suppressed. Tries exact match first, then scoped. */
export function matchSuppression(
  finding: Finding,
  suppressions: Suppression[],
): MatchResult {
  const fp = fingerprint(finding);

  // Exact match first (high confidence)
  const exact = suppressions.find(
    (s) => s.exactKey === fp.exactKey && !isExpired(s),
  );
  if (exact) {
    return { matched: true, suppression: exact, tier: 'exact' };
  }

  // Scoped match (rename-tolerant, only for scoped-tier suppressions)
  const scoped = suppressions.find(
    (s) => s.tier === 'scoped' && s.scopedKey === fp.scopedKey && !isExpired(s),
  );
  if (scoped) {
    return { matched: true, suppression: scoped, tier: 'scoped' };
  }

  return { matched: false };
}

/** Check if a suppression has expired based on TTL */
export function isExpired(suppression: Suppression): boolean {
  const lastSeen = new Date(suppression.lastSeenAt).getTime();
  const ttlMs = suppression.ttlDays * 24 * 60 * 60 * 1000;
  return Date.now() - lastSeen > ttlMs;
}
