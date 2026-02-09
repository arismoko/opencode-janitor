import { describe, expect, it } from 'bun:test';
import {
  branchKey,
  commitKey,
  extractHeadSha,
  extractWorkspaceHeadFromKey,
  parseReviewKey,
  prKey,
  workspaceKey,
} from './review-key';

describe('review-key', () => {
  it('parses commit keys', () => {
    const sha = 'abc123';
    expect(parseReviewKey(commitKey(sha))).toEqual({ type: 'commit', sha });
  });

  it('parses PR keys', () => {
    const key = prKey(42, 'deadbeef');
    expect(parseReviewKey(key)).toEqual({
      type: 'pr',
      number: 42,
      headSha: 'deadbeef',
    });
  });

  it('rejects malformed keys', () => {
    expect(parseReviewKey('pr:not-a-number:abc')).toBeNull();
    expect(parseReviewKey('commit')).toBeNull();
    expect(parseReviewKey('unknown:thing')).toBeNull();
  });

  it('extracts head SHA across key types', () => {
    expect(extractHeadSha(commitKey('c1'))).toBe('c1');
    expect(extractHeadSha(prKey(7, 'p1'))).toBe('p1');
    expect(extractHeadSha(branchKey('main', 'b1'))).toBe('b1');
    expect(extractHeadSha('invalid')).toBeNull();
  });

  it('extracts workspace head SHA or preserves non-workspace keys', () => {
    expect(extractWorkspaceHeadFromKey(workspaceKey('main', 'w1'))).toBe('w1');
    const key = commitKey('keep-me');
    expect(extractWorkspaceHeadFromKey(key)).toBe(key);
  });
});
