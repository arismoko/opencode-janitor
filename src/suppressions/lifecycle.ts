import { fingerprint } from '../findings/fingerprint';
import type { Finding } from '../types';
import type { Suppression } from './types';

/** Create a new suppression from a finding */
export function createSuppression(
  finding: Finding,
  sha: string,
  opts?: { tier?: 'exact' | 'scoped'; reason?: string; ttlDays?: number },
): Suppression {
  const fp = fingerprint(finding);
  const now = new Date().toISOString();

  return {
    exactKey: fp.exactKey,
    scopedKey: fp.scopedKey,
    tier: opts?.tier ?? 'exact',
    reason: opts?.reason,
    createdAt: now,
    lastSeenAt: now,
    ttlDays: opts?.ttlDays ?? 90,
    original: {
      domain: finding.domain,
      location: finding.location,
      evidence: finding.evidence,
      prescription: finding.prescription,
      sha,
    },
  };
}
