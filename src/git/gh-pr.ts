import { warn } from '../utils/logger';

/** PR info retrieved from the gh CLI */
export interface GhPrInfo {
  number: number;
  baseRef: string;
  headRef: string;
  headSha: string;
}

/**
 * Check whether the `gh` CLI is available and functional.
 * Returns false if gh is missing, not authenticated, or errors.
 */
export async function isGhAvailable(
  exec: (cmd: string) => Promise<string>,
): Promise<boolean> {
  try {
    await exec('gh --version');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current PR associated with the checked-out branch via `gh pr view`.
 * Returns null if no PR exists, gh is unavailable, or any error occurs.
 */
export async function getCurrentPrFromGh(
  exec: (cmd: string) => Promise<string>,
): Promise<GhPrInfo | null> {
  try {
    const repo = await resolveRepoSlug(exec);
    if (!repo) return null;

    const raw = await exec(
      `GH_PROMPT_DISABLED=1 gh pr view --repo '${repo}' --json number,url,baseRefName,headRefName,headRefOid`,
    );

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      warn('[gh-pr] failed to parse gh pr view JSON output');
      return null;
    }

    const number = parsed.number;
    if (typeof number !== 'number' || !Number.isFinite(number)) {
      warn('[gh-pr] missing or invalid PR number in gh output');
      return null;
    }

    const baseRef = parsed.baseRefName;
    const headRef = parsed.headRefName;
    const headSha = parsed.headRefOid;

    if (
      typeof baseRef !== 'string' ||
      typeof headRef !== 'string' ||
      typeof headSha !== 'string'
    ) {
      warn('[gh-pr] missing ref fields in gh output');
      return null;
    }

    return {
      number,
      baseRef,
      headRef,
      headSha,
    };
  } catch {
    // gh not installed, not authenticated, no PR for branch, etc.
    return null;
  }
}

/**
 * Post a review comment on a PR using `gh pr review`.
 * Returns true on success, false on any failure.
 */
export async function postPrReviewWithGh(
  exec: (cmd: string) => Promise<string>,
  prNumber: number,
  body: string,
): Promise<boolean> {
  try {
    const repo = await resolveRepoSlug(exec);
    if (!repo) return false;

    // Escape single quotes in body for shell safety
    const escapedBody = body.replace(/'/g, "'\\''");
    await exec(
      `GH_PROMPT_DISABLED=1 gh pr review ${prNumber} --repo '${repo}' --comment --body '${escapedBody}'`,
    );
    return true;
  } catch (err) {
    warn(`[gh-pr] failed to post review on PR #${prNumber}: ${err}`);
    return false;
  }
}

async function resolveRepoSlug(
  exec: (cmd: string) => Promise<string>,
): Promise<string | null> {
  try {
    const remote = (await exec('git remote get-url origin')).trim();
    if (!remote) return null;

    // https://github.com/owner/repo(.git)
    let match = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }

    // Fallback for uncommon URL forms
    match = remote.match(/([^/:]+)\/([^/]+?)(?:\.git)?$/);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }

    return null;
  } catch {
    return null;
  }
}
