import { describe, expect, it } from 'bun:test';
import { AGENT_IDS } from '@opencode-janitor/shared';
import {
  buildManualPayload,
  type ManualJobPayload,
  parseReviewJobPayload,
} from './review-job-payload';

const defaultAgent = AGENT_IDS[0];

describe('review job payload', () => {
  it('builds and parses manual payload with note and focusPath', () => {
    const payload = buildManualPayload({
      agent: defaultAgent,
      requestedScope: 'repo',
      input: { path: 'src/features/payments' },
      note: 'DO NOTHING JUST SAY HI :3',
      focusPath: 'src/features/payments',
      sha: 'abc123',
    });

    expect(payload).toEqual({
      agent: defaultAgent,
      requestedScope: 'repo',
      input: { path: 'src/features/payments' },
      note: 'DO NOTHING JUST SAY HI :3',
      focusPath: 'src/features/payments',
      sha: 'abc123',
    });

    const parsed = parseReviewJobPayload(
      JSON.stringify(payload),
      'manual',
    ) as ManualJobPayload;

    expect(parsed.note).toBe('DO NOTHING JUST SAY HI :3');
    expect(parsed.focusPath).toBe('src/features/payments');
  });

  it('trims note and focusPath in manual payload parsing', () => {
    const parsed = parseReviewJobPayload(
      JSON.stringify({
        agent: defaultAgent,
        note: '  hi  ',
        focusPath: '  src/foo  ',
      }),
      'manual',
    ) as ManualJobPayload;

    expect(parsed.note).toBe('hi');
    expect(parsed.focusPath).toBe('src/foo');
  });
});
