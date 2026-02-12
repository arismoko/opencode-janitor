import { describe, expect, it } from 'bun:test';
import {
  formatFindingAsXmlMarkdown,
  formatFindingsAsXmlMarkdown,
} from './finding-copy-format.js';

describe('finding copy formatter', () => {
  it('formats primitive fields with kebab-case XML tags', () => {
    const output = formatFindingAsXmlMarkdown({
      severity: 'P1',
      scoreValue: 42,
      isRegression: true,
      notes: null,
      '2nd field': 'x',
    });

    expect(output).toContain('<severity>P1</severity>');
    expect(output).toContain('<score-value>42</score-value>');
    expect(output).toContain('<is-regression>`true`</is-regression>');
    expect(output).toContain('<notes>`null`</notes>');
    expect(output).toContain('<field-2nd-field>x</field-2nd-field>');
  });

  it('formats nested objects recursively', () => {
    const output = formatFindingAsXmlMarkdown({
      enrichments: {
        architecture: {
          antiPattern: {
            label: 'LAYERING_VIOLATION',
          },
        },
      },
    });

    expect(output).toContain('<enrichments>');
    expect(output).toContain('<architecture>');
    expect(output).toContain('<anti-pattern>');
    expect(output).toContain('<label>LAYERING_VIOLATION</label>');
  });

  it('formats primitive arrays as markdown bullet lists', () => {
    const output = formatFindingAsXmlMarkdown({
      tags: ['alpha', 'beta', true, null],
    });

    expect(output).toContain('<tags>');
    expect(output).toContain('- alpha');
    expect(output).toContain('- beta');
    expect(output).toContain('- `true`');
    expect(output).toContain('- `null`');
  });

  it('escapes XML special characters in text content', () => {
    const output = formatFindingAsXmlMarkdown({
      evidence: `<unsafe>&"'`,
    });

    expect(output).toContain(
      '<evidence>&lt;unsafe&gt;&amp;&quot;&apos;</evidence>',
    );
  });

  it('wraps copy-all output with findings root and indexed finding items', () => {
    const output = formatFindingsAsXmlMarkdown([
      { severity: 'P1' },
      { severity: 'P2' },
    ]);

    expect(output.startsWith('<findings>')).toBe(true);
    expect(output).toContain('<finding index="1">');
    expect(output).toContain('<finding index="2">');
    expect(output).toContain('<severity>P1</severity>');
    expect(output).toContain('<severity>P2</severity>');
    expect(output.endsWith('</findings>')).toBe(true);
  });
});
