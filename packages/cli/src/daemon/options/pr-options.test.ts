import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { ensureSchema } from '../../db/migrations';
import { addRepo } from '../../db/queries/repo-queries';
import type { RuntimeContext } from '../../runtime/context';
import { createPrOptions } from './pr-options';

function createDb(): Database {
  const db = new Database(':memory:');
  ensureSchema(db);
  return db;
}

function seedRepo(db: Database) {
  return addRepo(db, {
    path: '/tmp/repo-prs',
    gitDir: '/tmp/repo-prs/.git',
    defaultBranch: 'main',
  });
}

function createRuntimeContext(db: Database): RuntimeContext {
  return {
    db,
  } as RuntimeContext;
}

describe('createPrOptions', () => {
  it('composes list query for review-requested bucket and parses rows', async () => {
    const db = createDb();
    const repo = seedRepo(db);
    const calls: string[][] = [];
    const pr = createPrOptions(createRuntimeContext(db), {
      runGh: (_cwd, args) => {
        calls.push(args);
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              number: 42,
              title: 'Fix flaky test',
              state: 'OPEN',
              url: 'https://example.test/pr/42',
              author: { login: 'dev-a' },
              updatedAt: '2026-02-12T00:00:00Z',
              reviewDecision: 'REVIEW_REQUIRED',
              isDraft: false,
              mergeable: 'MERGEABLE',
              reviewRequests: [{ requestedReviewer: { login: 'alice' } }],
            },
          ]),
          stderr: '',
        };
      },
    });

    const response = await pr.listPrs({
      repoOrId: repo.id,
      bucket: 'review-requested',
      query: 'label:urgent',
      limit: 25,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('pr');
    expect(calls[0]).toContain('list');
    expect(calls[0]).toContain('--search');
    expect(calls[0]).toContain('is:open review-requested:@me label:urgent');
    expect(response.items[0]?.number).toBe(42);
    expect(response.items[0]?.requestedReviewers).toEqual(['alice']);
  });

  it('maps all bucket queries correctly', async () => {
    const db = createDb();
    const repo = seedRepo(db);
    const searches: string[] = [];
    const pr = createPrOptions(createRuntimeContext(db), {
      runGh: (_cwd, args) => {
        const searchIndex = args.indexOf('--search');
        searches.push(searchIndex >= 0 ? args[searchIndex + 1] || '' : '');
        return { exitCode: 0, stdout: '[]', stderr: '' };
      },
    });

    await pr.listPrs({ repoOrId: repo.path, bucket: 'all-open' });
    await pr.listPrs({ repoOrId: repo.path, bucket: 'review-requested' });
    await pr.listPrs({ repoOrId: repo.path, bucket: 'assigned' });
    await pr.listPrs({ repoOrId: repo.path, bucket: 'created-by-me' });
    await pr.listPrs({ repoOrId: repo.path, bucket: 'mentioned' });

    expect(searches).toEqual([
      'is:open',
      'is:open review-requested:@me',
      'is:open assignee:@me',
      'is:open author:@me',
      'is:open mentions:@me',
    ]);
  });

  it('loads detail via gh pr view + gh api comments', async () => {
    const db = createDb();
    const repo = seedRepo(db);
    const calls: string[][] = [];
    const pr = createPrOptions(createRuntimeContext(db), {
      runGh: (_cwd, args) => {
        calls.push(args);
        if (args[0] === 'pr' && args[1] === 'view') {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              number: 77,
              title: 'Add PR tab',
              state: 'OPEN',
              url: 'https://example.test/pr/77',
              author: { login: 'dev-b' },
              updatedAt: '2026-02-12T01:00:00Z',
              reviewDecision: null,
              isDraft: false,
              mergeable: 'MERGEABLE',
              reviewRequests: [],
              body: 'Implements the PR dashboard tab.',
              baseRefName: 'main',
              headRefName: 'feature/pr-tab',
              additions: 100,
              deletions: 12,
              changedFiles: 8,
              commits: [
                {
                  oid: 'abcdef1234567890',
                  messageHeadline: 'feat: add PR tab',
                  authoredDate: '2026-02-12T01:03:00Z',
                  authors: { nodes: [{ login: 'dev-b' }] },
                },
              ],
              mergedAt: null,
              mergeStateStatus: 'CLEAN',
              comments: [
                {
                  id: 11,
                  author: { login: 'alice' },
                  body: 'Top-level note',
                  createdAt: '2026-02-12T01:10:00Z',
                  updatedAt: '2026-02-12T01:10:00Z',
                  url: 'https://example.test/comment/11',
                },
              ],
            }),
            stderr: '',
          };
        }

        if (args[0] === 'repo' && args[1] === 'view') {
          return {
            exitCode: 0,
            stdout: 'owner/repo',
            stderr: '',
          };
        }

        if (args[0] === 'api') {
          return {
            exitCode: 0,
            stdout: JSON.stringify([
              {
                id: 22,
                in_reply_to_id: null,
                user: { login: 'bob' },
                body: 'Inline review comment',
                path: 'src/app.ts',
                line: 17,
                html_url: 'https://example.test/review/22',
                created_at: '2026-02-12T01:20:00Z',
                updated_at: '2026-02-12T01:20:00Z',
              },
            ]),
            stderr: '',
          };
        }

        return { exitCode: 1, stdout: '', stderr: 'unexpected' };
      },
    });

    const response = await pr.getPrDetail({ repoOrId: repo.id, prNumber: 77 });
    expect(calls).toHaveLength(3);
    expect(response.detail.number).toBe(77);
    expect(response.detail.commitHistory).toHaveLength(1);
    expect(response.detail.issueComments).toHaveLength(1);
    expect(response.detail.reviewComments).toHaveLength(1);
    expect(response.detail.reviewComments[0]?.path).toBe('src/app.ts');
  });

  it('constructs action commands correctly', async () => {
    const db = createDb();
    const repo = seedRepo(db);
    const calls: string[][] = [];
    const pr = createPrOptions(createRuntimeContext(db), {
      runGh: (_cwd, args) => {
        calls.push(args);
        if (args[0] === 'repo' && args[1] === 'view') {
          return { exitCode: 0, stdout: 'owner/repo', stderr: '' };
        }
        return { exitCode: 0, stdout: '{}', stderr: '' };
      },
    });

    await pr.mergePr({ repoOrId: repo.id, prNumber: 5, method: 'rebase' });
    await pr.commentPr({ repoOrId: repo.id, prNumber: 5, body: 'Ship it' });
    await pr.requestReviewers({
      repoOrId: repo.id,
      prNumber: 5,
      reviewers: ['alice', 'bob'],
    });
    await pr.replyReviewComment({
      repoOrId: repo.id,
      prNumber: 5,
      commentId: 99,
      body: 'Done',
    });

    expect(calls[0]).toEqual(['pr', 'merge', '5', '--rebase']);
    expect(calls[1]).toEqual(['pr', 'comment', '5', '--body', 'Ship it']);
    expect(calls[2]).toEqual([
      'pr',
      'edit',
      '5',
      '--add-reviewer',
      'alice,bob',
    ]);
    expect(calls[3]).toEqual([
      'repo',
      'view',
      '--json',
      'nameWithOwner',
      '--jq',
      '.nameWithOwner',
    ]);
    expect(calls[4]).toEqual([
      'api',
      'repos/owner/repo/pulls/comments/99/replies',
      '-f',
      'body=Done',
    ]);
  });

  it('surfaces gh failures as clear errors', async () => {
    const db = createDb();
    const repo = seedRepo(db);
    const pr = createPrOptions(createRuntimeContext(db), {
      runGh: () => ({ exitCode: 1, stdout: '', stderr: 'not authenticated' }),
    });

    await expect(
      pr.mergePr({ repoOrId: repo.id, prNumber: 1 }),
    ).rejects.toThrow('not authenticated');
  });
});
