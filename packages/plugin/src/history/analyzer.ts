import { fingerprint } from '../findings/fingerprint';
import type { Finding } from '../types';
import type {
  AnnotatedFinding,
  FindingLedgerEntry,
  FindingLifecycle,
} from './types';

/** Annotate current findings with lifecycle state relative to the ledger */
export function analyzeLifecycle(
  currentFindings: Finding[],
  ledger: FindingLedgerEntry[],
): AnnotatedFinding[] {
  const ledgerByExact = new Map(ledger.map((e) => [e.exactKey, e]));
  const ledgerByScoped = new Map(ledger.map((e) => [e.scopedKey, e]));

  return currentFindings.map((finding) => {
    const fp = fingerprint(finding);
    const entry =
      ledgerByExact.get(fp.exactKey) ?? ledgerByScoped.get(fp.scopedKey);

    let lifecycle: FindingLifecycle;
    let streak: number;

    if (!entry) {
      lifecycle = 'new';
      streak = 1;
    } else if (entry.state === 'resolved') {
      lifecycle = 'regressed';
      streak = 1;
    } else {
      lifecycle = 'persistent';
      streak = entry.consecutiveRuns + 1;
    }

    return {
      finding,
      exactKey: fp.exactKey,
      scopedKey: fp.scopedKey,
      lifecycle,
      streak,
    };
  });
}

/** Detect findings that were active in the ledger but absent from current review */
export function detectResolved(
  currentExactKeys: Set<string>,
  currentScopedKeys: Set<string>,
  ledger: FindingLedgerEntry[],
): FindingLedgerEntry[] {
  return ledger.filter(
    (entry) =>
      entry.state === 'active' &&
      !currentExactKeys.has(entry.exactKey) &&
      !currentScopedKeys.has(entry.scopedKey),
  );
}
