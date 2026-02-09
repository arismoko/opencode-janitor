import { log, warn } from '../utils/logger';
import { shellEscapeQuoted } from '../utils/workspace-git';

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
 * Returns null for expected no-PR states (no PR for branch, not logged in,
 * PR is closed/merged). Throws on unexpected/transient gh failures to
 * preserve retry semantics in the caller.
 */
export async function getCurrentPrFromGh(
  exec: (cmd: string) => Promise<string>,
): Promise<GhPrInfo | null> {
  try {
    const repo = await resolveRepoSlug(exec);
    if (!repo) return null;

    // Must pass the current branch when using --repo, otherwise gh errors
    // with "argument required when using the --repo flag".
    const branch = (await exec('git rev-parse --abbrev-ref HEAD')).trim();
    if (!branch || branch === 'HEAD') return null;

    const raw = await exec(
      `GH_PROMPT_DISABLED=1 gh pr view ${shellEscapeQuoted(branch)} --repo ${shellEscapeQuoted(repo)} --json number,url,baseRefName,headRefName,headRefOid,state`,
    );

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      log('[gh-pr] failed to parse gh pr view JSON output');
      return null;
    }

    // Only track OPEN PRs — closed/merged PRs should not trigger reviews.
    if (parsed.state !== 'OPEN') return null;

    const number = parsed.number;
    if (typeof number !== 'number' || !Number.isFinite(number)) {
      log('[gh-pr] missing or invalid PR number in gh output');
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
      log('[gh-pr] missing ref fields in gh output');
      return null;
    }

    return {
      number,
      baseRef,
      headRef,
      headSha,
    };
  } catch (err) {
    // Expected: no PR for this branch, not logged in, etc. — return null
    // so the detector treats it as "no actionable state".
    if (isExpectedNoPrError(err)) return null;
    // Unexpected: transient network/gh failure — re-throw so
    // SignalDetector.verify does NOT mark this key as processed,
    // allowing retry on the next poll cycle.
    throw err;
  }
}

/**
 * Get a specific PR by number via `gh pr view <number>`.
 * Returns null for expected no-PR states and closed/merged PRs.
 */
export async function getPrByNumberFromGh(
  exec: (cmd: string) => Promise<string>,
  number: number,
): Promise<GhPrInfo | null> {
  if (!Number.isFinite(number) || number <= 0) return null;
  try {
    const repo = await resolveRepoSlug(exec);
    if (!repo) return null;

    const raw = await exec(
      `GH_PROMPT_DISABLED=1 gh pr view ${number} --repo ${shellEscapeQuoted(repo)} --json number,url,baseRefName,headRefName,headRefOid,state`,
    );

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      log('[gh-pr] failed to parse gh pr view JSON output');
      return null;
    }

    if (parsed.state !== 'OPEN') return null;

    const parsedNumber = parsed.number;
    if (typeof parsedNumber !== 'number' || !Number.isFinite(parsedNumber)) {
      log('[gh-pr] missing or invalid PR number in gh output');
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
      log('[gh-pr] missing ref fields in gh output');
      return null;
    }

    return {
      number: parsedNumber,
      baseRef,
      headRef,
      headSha,
    };
  } catch (err) {
    if (isExpectedNoPrError(err)) return null;
    throw err;
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

    // Escape single quotes in body and repo for shell safety
    const escapedBody = shellEscapeQuoted(body);
    await exec(
      `GH_PROMPT_DISABLED=1 gh pr review ${prNumber} --repo ${shellEscapeQuoted(repo)} --comment --body ${escapedBody}`,
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

function isExpectedNoPrError(err: unknown): boolean {
  const msg = String(err ?? '').toLowerCase();
  return (
    msg.includes('no pull requests found for branch') ||
    msg.includes('could not resolve to a pull request') ||
    msg.includes('not a git repository') ||
    msg.includes('authentication required') ||
    msg.includes('not logged into any github hosts')
  );
}
