// ── Discriminated union for parsed review keys ──────────────────────────

export type ReviewKey =
  | { type: 'commit'; sha: string }
  | { type: 'pr'; number: number; headSha: string }
  | { type: 'branch'; branch: string; headSha: string }
  | { type: 'workspace'; branch: string; headSha: string }
  | { type: 'manual'; id: string; headSha: string };

// ── Parser ──────────────────────────────────────────────────────────────

/** Parse a raw key string into a typed `ReviewKey`, or `null` if malformed. */
export function parseReviewKey(key: string): ReviewKey | null {
  const parts = key.split(':');
  switch (parts[0]) {
    case 'commit':
      return parts.length === 2 && parts[1]
        ? { type: 'commit', sha: parts[1] }
        : null;

    case 'pr': {
      if (parts.length < 3 || !parts[1] || !parts[2]) return null;
      const num = Number(parts[1]);
      if (!Number.isInteger(num) || num <= 0) return null;
      return { type: 'pr', number: num, headSha: parts[2] };
    }

    case 'branch':
      return parts.length >= 3 && parts[1] && parts[2]
        ? { type: 'branch', branch: parts[1], headSha: parts[2] }
        : null;

    case 'workspace':
      return parts.length >= 3 && parts[1] && parts[2]
        ? { type: 'workspace', branch: parts[1], headSha: parts[2] }
        : null;

    case 'manual':
      return parts.length >= 3 && parts[1] && parts[2]
        ? { type: 'manual', id: parts[1], headSha: parts[2] }
        : null;

    default:
      return null;
  }
}

// ── Key constructors ────────────────────────────────────────────────────

export function commitKey(sha: string): string {
  return `commit:${sha}`;
}

export function prKey(number: number, headSha: string): string {
  return `pr:${number}:${headSha}`;
}

export function branchKey(branch: string, headSha: string): string {
  return `branch:${branch}:${headSha}`;
}

export function workspaceKey(branch: string, headSha: string): string {
  return `workspace:${branch}:${headSha}`;
}

export function manualKey(id: string, headSha: string): string {
  return `manual:${id}:${headSha}`;
}

// ── Extractors ──────────────────────────────────────────────────────────

/** Extract the head SHA from any key type, or `null` for malformed keys. */
export function extractHeadSha(key: string): string | null {
  const parsed = parseReviewKey(key);
  if (!parsed) return null;
  return parsed.type === 'commit' ? parsed.sha : parsed.headSha;
}

/**
 * Extract the head SHA from a workspace key, or return the key unchanged.
 *
 * If key matches `workspace:<branch>:<sha>`, returns the sha portion.
 * Otherwise returns the key as-is.
 */
export function extractWorkspaceHeadFromKey(key: string): string {
  const parsed = parseReviewKey(key);
  return parsed?.type === 'workspace' ? parsed.headSha : key;
}
