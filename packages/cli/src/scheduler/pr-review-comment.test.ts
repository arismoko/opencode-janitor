import { describe, expect, it } from 'bun:test';
import { AGENT_IDS } from '@opencode-janitor/shared';
import {
  buildPrReviewCommentBody,
  extractPrNumberAndSha,
  postPrReviewComment,
  truncateCommentBody,
} from './pr-review-comment';

const firstAgent = AGENT_IDS[0];
const secondAgent = AGENT_IDS[1] ?? AGENT_IDS[0];
const thirdAgent = AGENT_IDS[2] ?? AGENT_IDS[0];
const fourthAgent = AGENT_IDS[3] ?? AGENT_IDS[0];

describe('pr review comment helper', () => {
  it('extracts PR number and sha from pr payload', () => {
    const parsed = extractPrNumberAndSha({
      payload_json: JSON.stringify({ prNumber: 42, sha: 'abc123' }),
    });

    expect(parsed).toEqual({ prNumber: 42, sha: 'abc123' });
  });

  it('formats markdown body with findings', () => {
    const body = buildPrReviewCommentBody({
      run: { id: 'rrn_1', agent: secondAgent },
      sha: 'abc123',
      findings: [
        {
          repo_id: 'repo_1',
          agent: secondAgent,
          severity: 'P1',
          domain: 'BUG',
          location: 'src/app.ts:12',
          evidence: 'Potential null dereference.',
          prescription: 'Guard before access.',
          details_json: '{}',
          fingerprint: 'fp_1',
        },
      ],
    });

    expect(body).toContain(`- Agent: \`${secondAgent}\``);
    expect(body).toContain('- Review run: `rrn_1`');
    expect(body).toContain('- Commit: `abc123`');
    expect(body).toContain('### Findings');
    expect(body).toContain('1. **P1 · BUG**');
    expect(body).toContain('- Location: `src/app.ts:12`');
    expect(body).toContain('- Evidence: Potential null dereference.');
    expect(body).toContain('- Prescription: Guard before access.');
  });

  it('formats no-findings body clearly', () => {
    const body = buildPrReviewCommentBody({
      run: { id: 'rrn_2', agent: firstAgent },
      findings: [],
    });

    expect(body).toContain('- Findings: **0**');
    expect(body).toContain(
      'No findings were reported for this PR-triggered review run.',
    );
  });

  it('truncates oversized body with explicit suffix', () => {
    const oversized = `${'x'.repeat(70_000)}`;
    const truncated = truncateCommentBody(oversized);

    expect(truncated.length).toBeLessThanOrEqual(60_000);
    expect(truncated.endsWith('...truncated')).toBe(true);
  });

  it('invokes gh pr comment with expected args', async () => {
    let receivedArgs: string[] | undefined;
    const result = await postPrReviewComment(
      {
        id: 'rrn_3',
        agent: fourthAgent,
        path: '/tmp/repo',
        payload_json: JSON.stringify({ prNumber: 7, sha: 'def456' }),
      },
      [],
      {
        runGh: (_cwd, args) => {
          receivedArgs = args;
          return { exitCode: 0, stdout: 'ok', stderr: '' };
        },
      },
    );

    expect(result).toEqual({ ok: true, prNumber: 7 });
    expect(receivedArgs?.[0]).toBe('pr');
    expect(receivedArgs?.[1]).toBe('comment');
    expect(receivedArgs?.[2]).toBe('7');
    expect(receivedArgs?.[3]).toBe('--body');
    expect(typeof receivedArgs?.[4]).toBe('string');
  });

  it('returns failure result when gh exits non-zero', async () => {
    const result = await postPrReviewComment(
      {
        id: 'rrn_4',
        agent: thirdAgent,
        path: '/tmp/repo',
        payload_json: JSON.stringify({ prNumber: 8, sha: 'ghi789' }),
      },
      [],
      {
        runGh: () => ({
          exitCode: 1,
          stdout: '',
          stderr: 'not authenticated',
        }),
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.prNumber).toBe(8);
      expect(result.error).toContain('not authenticated');
    }
  });
});
