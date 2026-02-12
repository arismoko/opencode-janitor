import { resolve as resolvePath } from 'node:path';
import { findRepoByIdOrPath } from '../../db/queries/repo-queries';
import type {
  PrCommit,
  PrDetail,
  PrIssueComment,
  PrListBucket,
  PrReviewComment,
  PrSummary,
} from '../../ipc/protocol';
import type { RuntimeContext } from '../../runtime/context';
import { type GitCommandResult, runGhCommand } from '../../utils/git';
import type { PrApi } from '../socket-types';

type RunGh = (
  cwd: string,
  args: string[],
  options?: { trimOutput?: boolean },
) => GitCommandResult;

const BUCKET_QUERY: Record<PrListBucket, string> = {
  'all-open': 'is:open',
  'review-requested': 'is:open review-requested:@me',
  assigned: 'is:open assignee:@me',
  'created-by-me': 'is:open author:@me',
  mentioned: 'is:open mentions:@me',
};

function toErrorMessage(result: GitCommandResult): string {
  return result.stderr || result.stdout || `gh exited with ${result.exitCode}`;
}

function parseJson<T>(value: string, context: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Failed to parse JSON from ${context}`);
  }
}

function ensureGhSuccess(result: GitCommandResult, context: string): string {
  if (result.exitCode !== 0) {
    throw new Error(`${context}: ${toErrorMessage(result)}`);
  }
  return result.stdout;
}

function normalizeRequestedReviewers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const logins = value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const requestedReviewer =
        (entry as { requestedReviewer?: unknown }).requestedReviewer ?? entry;
      if (!requestedReviewer || typeof requestedReviewer !== 'object') {
        return null;
      }
      const login = (requestedReviewer as { login?: unknown }).login;
      return typeof login === 'string' && login.trim() ? login.trim() : null;
    })
    .filter((login): login is string => typeof login === 'string');
  return [...new Set(logins)];
}

function toPrSummary(item: Record<string, unknown>): PrSummary {
  const number =
    typeof item.number === 'number' && Number.isInteger(item.number)
      ? item.number
      : 0;
  const title = typeof item.title === 'string' ? item.title : '';
  const state = typeof item.state === 'string' ? item.state : 'OPEN';
  const url = typeof item.url === 'string' ? item.url : '';
  const authorLogin =
    item.author && typeof item.author === 'object'
      ? ((item.author as { login?: unknown }).login ?? null)
      : null;
  const updatedAt =
    typeof item.updatedAt === 'string'
      ? item.updatedAt
      : new Date(0).toISOString();
  const reviewDecision =
    typeof item.reviewDecision === 'string' ? item.reviewDecision : null;
  const mergeable = typeof item.mergeable === 'string' ? item.mergeable : null;
  const isDraft = Boolean(item.isDraft);

  return {
    number,
    title,
    state,
    url,
    authorLogin: typeof authorLogin === 'string' ? authorLogin : null,
    isDraft,
    reviewDecision,
    mergeable,
    updatedAt,
    requestedReviewers: normalizeRequestedReviewers(item.reviewRequests),
  };
}

function toIssueComments(raw: unknown): PrIssueComment[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw &&
        typeof raw === 'object' &&
        Array.isArray((raw as { nodes?: unknown }).nodes)
      ? ((raw as { nodes: unknown[] }).nodes ?? [])
      : [];

  const result: PrIssueComment[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const source = row as Record<string, unknown>;
    const id =
      typeof source.id === 'number' ? source.id : Number(source.id ?? 0);
    const author = source.author;
    const authorLogin =
      author && typeof author === 'object'
        ? ((author as { login?: unknown }).login ?? null)
        : null;
    result.push({
      id: Number.isFinite(id) ? id : 0,
      authorLogin: typeof authorLogin === 'string' ? authorLogin : null,
      body: typeof source.body === 'string' ? source.body : '',
      createdAt:
        typeof source.createdAt === 'string'
          ? source.createdAt
          : new Date(0).toISOString(),
      updatedAt:
        typeof source.updatedAt === 'string'
          ? source.updatedAt
          : new Date(0).toISOString(),
      url: typeof source.url === 'string' ? source.url : '',
    });
  }
  return result;
}

function toReviewComments(raw: unknown): PrReviewComment[] {
  if (!Array.isArray(raw)) return [];
  const result: PrReviewComment[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const source = row as Record<string, unknown>;
    const user = source.user;
    const authorLogin =
      user && typeof user === 'object'
        ? ((user as { login?: unknown }).login ?? null)
        : null;

    result.push({
      id: Number(source.id ?? 0),
      inReplyToId:
        typeof source.in_reply_to_id === 'number'
          ? source.in_reply_to_id
          : null,
      authorLogin: typeof authorLogin === 'string' ? authorLogin : null,
      body: typeof source.body === 'string' ? source.body : '',
      path: typeof source.path === 'string' ? source.path : null,
      line: typeof source.line === 'number' ? source.line : null,
      url: typeof source.html_url === 'string' ? source.html_url : '',
      createdAt:
        typeof source.created_at === 'string'
          ? source.created_at
          : new Date(0).toISOString(),
      updatedAt:
        typeof source.updated_at === 'string'
          ? source.updated_at
          : new Date(0).toISOString(),
    });
  }

  return result;
}

function toPrCommitHistory(raw: unknown): PrCommit[] {
  if (!Array.isArray(raw)) return [];
  const history: PrCommit[] = [];

  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const source = row as Record<string, unknown>;
    const oid = typeof source.oid === 'string' ? source.oid : '';
    const rawAuthors =
      source.authors && typeof source.authors === 'object'
        ? (source.authors as { nodes?: unknown[] }).nodes
        : null;
    const authorLogins = Array.isArray(rawAuthors)
      ? [
          ...new Set(
            rawAuthors
              .map((entry) => {
                if (!entry || typeof entry !== 'object') return null;
                const login = (entry as { login?: unknown }).login;
                return typeof login === 'string' && login.trim()
                  ? login.trim()
                  : null;
              })
              .filter((value): value is string => typeof value === 'string'),
          ),
        ]
      : [];

    history.push({
      oid,
      shortOid: oid ? oid.slice(0, 7) : '',
      messageHeadline:
        typeof source.messageHeadline === 'string'
          ? source.messageHeadline
          : typeof source.message === 'string'
            ? source.message.split('\n')[0] || '(no commit message)'
            : '(no commit message)',
      authoredDate:
        typeof source.authoredDate === 'string'
          ? source.authoredDate
          : new Date(0).toISOString(),
      authorLogins,
    });
  }

  return history;
}

function resolveRepoPath(rc: RuntimeContext, repoOrId: string): string {
  const normalized = resolvePath(repoOrId);
  const repo =
    findRepoByIdOrPath(rc.db, normalized) ??
    findRepoByIdOrPath(rc.db, repoOrId);

  if (!repo) {
    throw new Error(`Repository not found: ${repoOrId}. Use \`add\` first.`);
  }

  return repo.path;
}

function resolveRepoNameWithOwner(repoPath: string, runGh: RunGh): string {
  const stdout = ensureGhSuccess(
    runGh(repoPath, [
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '--jq',
      '.nameWithOwner',
    ]),
    'gh repo view failed',
  );
  if (!stdout || !stdout.includes('/')) {
    throw new Error('Unable to resolve owner/repo from gh repo view');
  }
  return stdout;
}

function buildSearch(bucket: PrListBucket, query?: string): string {
  const base = BUCKET_QUERY[bucket];
  const extra = typeof query === 'string' ? query.trim() : '';
  return extra ? `${base} ${extra}` : base;
}

export function createPrOptions(
  rc: RuntimeContext,
  deps?: { runGh?: RunGh },
): PrApi {
  const gh = deps?.runGh ?? runGhCommand;

  return {
    listPrs: async ({ repoOrId, bucket = 'all-open', query, limit = 30 }) => {
      const repoPath = resolveRepoPath(rc, repoOrId);
      const search = buildSearch(bucket, query);
      const stdout = ensureGhSuccess(
        gh(repoPath, [
          'pr',
          'list',
          '--limit',
          String(limit),
          '--search',
          search,
          '--json',
          'number,title,state,url,author,updatedAt,reviewDecision,isDraft,mergeable,reviewRequests',
        ]),
        'gh pr list failed',
      );

      const parsed = parseJson<unknown[]>(stdout, 'gh pr list');
      const items = Array.isArray(parsed)
        ? parsed
            .filter((item): item is Record<string, unknown> =>
              Boolean(item && typeof item === 'object'),
            )
            .map(toPrSummary)
        : [];

      return {
        ok: true as const,
        generatedAt: Date.now(),
        items,
      };
    },

    getPrDetail: async ({ repoOrId, prNumber }) => {
      const repoPath = resolveRepoPath(rc, repoOrId);
      const prViewStdout = ensureGhSuccess(
        gh(repoPath, [
          'pr',
          'view',
          String(prNumber),
          '--json',
          'number,title,state,url,author,updatedAt,reviewDecision,isDraft,mergeable,reviewRequests,body,baseRefName,headRefName,additions,deletions,changedFiles,commits,mergedAt,mergeStateStatus,comments',
        ]),
        'gh pr view failed',
      );
      const rawPr = parseJson<Record<string, unknown>>(
        prViewStdout,
        'gh pr view',
      );

      const nameWithOwner = resolveRepoNameWithOwner(repoPath, gh);
      const reviewCommentsStdout = ensureGhSuccess(
        gh(repoPath, [
          'api',
          `repos/${nameWithOwner}/pulls/${prNumber}/comments`,
        ]),
        'gh api pull comments failed',
      );
      const rawReviewComments = parseJson<unknown>(
        reviewCommentsStdout,
        'gh api pull comments',
      );

      const summary = toPrSummary(rawPr);
      const commitsRaw = rawPr.commits;
      const commitHistory = toPrCommitHistory(commitsRaw);
      const commits = Array.isArray(commitsRaw)
        ? commitsRaw.length
        : typeof commitsRaw === 'number' && Number.isFinite(commitsRaw)
          ? commitsRaw
          : 0;

      const detail: PrDetail = {
        ...summary,
        body: typeof rawPr.body === 'string' ? rawPr.body : '',
        baseRefName:
          typeof rawPr.baseRefName === 'string' ? rawPr.baseRefName : '',
        headRefName:
          typeof rawPr.headRefName === 'string' ? rawPr.headRefName : '',
        additions:
          typeof rawPr.additions === 'number' &&
          Number.isFinite(rawPr.additions)
            ? rawPr.additions
            : 0,
        deletions:
          typeof rawPr.deletions === 'number' &&
          Number.isFinite(rawPr.deletions)
            ? rawPr.deletions
            : 0,
        changedFiles:
          typeof rawPr.changedFiles === 'number' &&
          Number.isFinite(rawPr.changedFiles)
            ? rawPr.changedFiles
            : 0,
        commits,
        commitHistory,
        merged:
          typeof rawPr.mergedAt === 'string' && rawPr.mergedAt.length > 0
            ? true
            : summary.state.toUpperCase() === 'MERGED',
        mergeStateStatus:
          typeof rawPr.mergeStateStatus === 'string'
            ? rawPr.mergeStateStatus
            : null,
        issueComments: toIssueComments(rawPr.comments),
        reviewComments: toReviewComments(rawReviewComments),
      };

      return {
        ok: true as const,
        generatedAt: Date.now(),
        detail,
      };
    },

    mergePr: async ({ repoOrId, prNumber, method = 'merge' }) => {
      const repoPath = resolveRepoPath(rc, repoOrId);
      const methodFlag =
        method === 'squash'
          ? '--squash'
          : method === 'rebase'
            ? '--rebase'
            : '--merge';

      const result = gh(repoPath, [
        'pr',
        'merge',
        String(prNumber),
        methodFlag,
      ]);
      if (result.exitCode !== 0) {
        throw new Error(`gh pr merge failed: ${toErrorMessage(result)}`);
      }

      return {
        ok: true as const,
        merged: true,
        prNumber,
      };
    },

    commentPr: async ({ repoOrId, prNumber, body }) => {
      const repoPath = resolveRepoPath(rc, repoOrId);
      const result = gh(repoPath, [
        'pr',
        'comment',
        String(prNumber),
        '--body',
        body,
      ]);
      if (result.exitCode !== 0) {
        throw new Error(`gh pr comment failed: ${toErrorMessage(result)}`);
      }

      return {
        ok: true as const,
        commented: true,
        prNumber,
      };
    },

    requestReviewers: async ({ repoOrId, prNumber, reviewers }) => {
      const repoPath = resolveRepoPath(rc, repoOrId);
      const result = gh(repoPath, [
        'pr',
        'edit',
        String(prNumber),
        '--add-reviewer',
        reviewers.join(','),
      ]);
      if (result.exitCode !== 0) {
        throw new Error(`gh pr edit failed: ${toErrorMessage(result)}`);
      }

      return {
        ok: true as const,
        requested: true,
        prNumber,
        reviewers,
      };
    },

    replyReviewComment: async ({ repoOrId, prNumber, commentId, body }) => {
      const repoPath = resolveRepoPath(rc, repoOrId);
      const nameWithOwner = resolveRepoNameWithOwner(repoPath, gh);
      const result = gh(repoPath, [
        'api',
        `repos/${nameWithOwner}/pulls/comments/${commentId}/replies`,
        '-f',
        `body=${body}`,
      ]);
      if (result.exitCode !== 0) {
        throw new Error(`gh api replies failed: ${toErrorMessage(result)}`);
      }

      return {
        ok: true as const,
        replied: true,
        prNumber,
        commentId,
      };
    },
  };
}
