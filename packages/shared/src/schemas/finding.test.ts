import { describe, expect, it } from 'bun:test';
import { HunterOutput, JanitorOutput, Severity } from './finding';

describe('finding schemas', () => {
  it('accepts valid janitor output', () => {
    const parsed = JanitorOutput.parse({
      findings: [
        {
          domain: 'YAGNI',
          location: 'src/file.ts:12',
          severity: 'P1',
          evidence: 'unused abstraction introduced in this change',
          prescription: 'inline the abstraction and remove the wrapper',
        },
      ],
    });

    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.domain).toBe('YAGNI');
  });

  it('rejects invalid severity values', () => {
    const result = HunterOutput.safeParse({
      findings: [
        {
          domain: 'BUG',
          location: 'src/api.ts:33',
          severity: 'LOW',
          evidence: 'bad enum value',
          prescription: 'use P0-P3 severity',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('exposes canonical severity options', () => {
    expect(Severity.options).toEqual(['P0', 'P1', 'P2', 'P3']);
  });
});
