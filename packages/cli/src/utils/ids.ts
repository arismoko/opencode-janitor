/**
 * ID generation — deterministic-ish IDs (timestamp + random suffix).
 */

/**
 * Generate a short, sortable ID: base36 timestamp + 6-char random suffix.
 * Not cryptographically secure — adequate for local DB primary keys.
 */
export function makeId(prefix?: string): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  const base = `${ts}-${rand}`;
  return prefix ? `${prefix}-${base}` : base;
}
