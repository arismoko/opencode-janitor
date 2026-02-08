/**
 * Shared fingerprinting for findings.
 *
 * Produces two keys per finding:
 * - exactKey: high-precision (category + path suffix + shape + evidence hash)
 * - scopedKey: rename-tolerant (category + shape hash only)
 *
 * Used by both suppression memory and review history.
 * Leaf module — zero internal dependencies.
 */

export interface FindingFingerprint {
  exactKey: string;
  scopedKey: string;
}

/**
 * Compute fingerprint keys for a finding.
 */
export function fingerprint(finding: {
  category: string;
  location: string;
  evidence: string;
}): FindingFingerprint {
  const suffix = suffix2(finding.location);
  const shape = codeShapeHash(finding.evidence);
  const evidence = fnv1a(finding.evidence.trim());

  return {
    exactKey: `${finding.category}|${suffix}|${shape}|${evidence}`,
    scopedKey: `${finding.category}|${shape}`,
  };
}

/**
 * Extract last 2 path segments + line number from a location string.
 * e.g. "src/utils/helper.ts:42" → "utils/helper.ts:42"
 *
 * Tolerates project root renames but not internal restructuring.
 */
export function suffix2(location: string): string {
  const [filePath, ...rest] = location.split(':');
  const segments = filePath.split('/');
  const suffix = segments.slice(-2).join('/');
  return rest.length > 0 ? `${suffix}:${rest.join(':')}` : suffix;
}

/**
 * Normalize evidence text to a structural shape, then hash.
 * Strips whitespace variations, numbers, and string literals so that
 * structurally similar findings produce the same hash regardless of
 * variable names or literal values.
 */
export function codeShapeHash(evidence: string): string {
  const normalized = evidence
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\d+/g, 'N')
    .replace(/"[^"]*"/g, '"S"')
    .replace(/'[^']*'/g, "'S'")
    .replace(/`[^`]*`/g, '`S`');
  return fnv1a(normalized);
}

/**
 * FNV-1a 32-bit hash → 8-char hex string.
 * Fast, no crypto dependency, good distribution for short strings.
 */
export function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
