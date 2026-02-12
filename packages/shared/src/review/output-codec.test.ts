import { describe, expect, it } from 'bun:test';
import { parseAgentOutput } from './output-codec';

const HunterOutput = 'hunter' as const;
const JanitorOutput = 'janitor' as const;
const InspectorOutput = 'inspector' as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid hunter finding */
const validHunterFinding = {
  domain: 'BUG',
  location: 'src/api.ts:33',
  severity: 'P1',
  evidence: 'null dereference when user is undefined',
  prescription: 'add null check before accessing user.name',
};

/** Minimal valid janitor finding */
const validJanitorFinding = {
  domain: 'YAGNI',
  location: 'src/utils.ts:10',
  severity: 'P2',
  evidence: 'unused helper introduced in this change',
  prescription: 'remove the helper and inline the logic',
};

const validInspectorFinding = {
  domain: 'DESIGN',
  location: 'src/runtime/flow.ts:77',
  severity: 'P1',
  evidence: 'Execution flow mixes orchestration and adapter concerns.',
  prescription: 'Split orchestration policy from infrastructure adapters.',
  architecture: {
    principles: ['DEPENDENCY_INVERSION', 'EXPLICIT_BOUNDARIES'],
    antiPattern: {
      label: 'LAYERING_VIOLATION',
      detail: 'Domain policy reaches into transport/storage details.',
    },
    recommendedPattern: {
      label: 'HEXAGONAL_PORTS_ADAPTERS',
      detail:
        'Introduce explicit ports for orchestration dependencies and isolate adapters.',
    },
    rewritePlan: [
      'Define orchestrator port contracts.',
      'Implement adapters behind ports.',
      'Inject adapters at composition root.',
    ],
    tradeoffs: ['Additional interfaces', 'Requires dependency wiring updates'],
    impactScope: 'SUBSYSTEM',
  },
};

/** Wrap findings in a fenced JSON block */
function fenced(obj: unknown): string {
  return '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
}

describe('parseAgentOutput', () => {
  // -------------------------------------------------------------------------
  // 1. Empty output
  // -------------------------------------------------------------------------
  describe('empty output', () => {
    it('returns empty_output for empty string', () => {
      const result = parseAgentOutput('', HunterOutput);
      expect(result.output.findings).toEqual([]);
      expect(result.meta.status).toBe('empty_output');
      expect(result.meta.error).toBeDefined();
    });

    it('returns empty_output for whitespace-only string', () => {
      const result = parseAgentOutput('   \n\t  ', HunterOutput);
      expect(result.output.findings).toEqual([]);
      expect(result.meta.status).toBe('empty_output');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Fenced JSON extraction
  // -------------------------------------------------------------------------
  describe('fenced JSON extraction', () => {
    it('extracts JSON from ```json ... ``` blocks', () => {
      const payload = { findings: [validHunterFinding] };
      const raw = `Here is my analysis:\n\n${fenced(payload)}\n\nDone.`;

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.output.findings).toHaveLength(1);
      expect(result.output.findings[0]?.domain).toBe('BUG');
    });

    it('extracts JSON from bare ``` ... ``` blocks without json tag', () => {
      const payload = { findings: [validHunterFinding] };
      const raw =
        'Some preamble\n```\n' + JSON.stringify(payload) + '\n```\nEnd';

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.output.findings).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 3. "Last JSON wins" behavior
  // -------------------------------------------------------------------------
  describe('last JSON wins', () => {
    it('picks the last fenced block with valid findings', () => {
      const first = { findings: [{ ...validHunterFinding, severity: 'P0' }] };
      const second = { findings: [{ ...validHunterFinding, severity: 'P3' }] };
      const raw = `First attempt:\n${fenced(first)}\n\nRevised:\n${fenced(second)}`;

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('ok');
      // Last fenced block wins
      expect(result.output.findings[0]?.severity).toBe('P3');
    });

    it('skips non-findings fenced blocks and picks the valid one', () => {
      const notFindings = { summary: 'no issues' };
      const valid = { findings: [validHunterFinding] };
      const raw = `${fenced(notFindings)}\n\n${fenced(valid)}`;

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.output.findings).toHaveLength(1);
    });

    it('falls back to bare JSON when fenced blocks have no findings', () => {
      const notFindings = { summary: 'nope' };
      const payload = { findings: [validHunterFinding] };
      // Fenced block has wrong shape; bare JSON at the end has correct shape
      const raw =
        fenced(notFindings) +
        '\n\nHere is the real output: ' +
        JSON.stringify(payload);

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.output.findings).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. String-brace safety
  // -------------------------------------------------------------------------
  describe('string-brace safety', () => {
    it('handles curly braces inside JSON string values', () => {
      const finding = {
        ...validHunterFinding,
        evidence: 'the pattern `if (x) { return }` is wrong',
        prescription: 'change to `if (x) { throw new Error("{bad}") }`',
      };
      const payload = { findings: [finding] };
      const raw = JSON.stringify(payload);

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.output.findings[0]?.evidence).toContain('{');
      expect(result.output.findings[0]?.prescription).toContain('{bad}');
    });

    it('handles escaped quotes inside string values', () => {
      const finding = {
        ...validHunterFinding,
        evidence: 'uses "unsafe" eval with braces { }',
      };
      const payload = { findings: [finding] };
      const raw = 'Analysis:\n' + JSON.stringify(payload);

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.output.findings[0]?.evidence).toContain('"unsafe"');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Lowercase enum normalization
  // -------------------------------------------------------------------------
  describe('lowercase enum normalization', () => {
    it('normalizes lowercase severity "p1" to "P1"', () => {
      const finding = { ...validHunterFinding, severity: 'p1' };
      const payload = { findings: [finding] };
      const raw = JSON.stringify(payload);

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.output.findings[0]?.severity).toBe('P1');
    });

    it('normalizes lowercase domain "bug" to "BUG"', () => {
      const finding = { ...validHunterFinding, domain: 'bug' };
      const payload = { findings: [finding] };
      const raw = JSON.stringify(payload);

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.output.findings[0]?.domain).toBe('BUG');
    });

    it('normalizes mixed case domain to BUG when severity also needs normalization', () => {
      // When severity is valid, .catch() on domain absorbs bad values before
      // normalization runs. But when severity is ALSO lowercase (causing first
      // parse to fail), normalizeFindings uppercases both fields on retry.
      const finding = {
        ...validHunterFinding,
        domain: 'Security',
        severity: 'p0',
      };
      const payload = { findings: [finding] };
      const raw = JSON.stringify(payload);

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.output.findings[0]?.domain).toBe('BUG');
      expect(result.output.findings[0]?.severity).toBe('P0');
    });

    it('domain .catch() absorbs mixed case when severity is already valid', () => {
      // When severity is valid, first parse succeeds — .catch('BUG') absorbs
      // the unrecognized domain value "Security" rather than going through
      // normalization.
      const finding = {
        ...validHunterFinding,
        domain: 'Security',
        severity: 'P1',
      };
      const payload = { findings: [finding] };
      const raw = JSON.stringify(payload);

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.output.findings[0]?.domain).toBe('BUG'); // .catch() fallback
    });

    it('normalizes janitor domains too ("yagni" → "YAGNI")', () => {
      const finding = {
        ...validJanitorFinding,
        domain: 'yagni',
        severity: 'p2',
      };
      const payload = { findings: [finding] };
      const raw = JSON.stringify(payload);

      const result = parseAgentOutput(raw, JanitorOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.output.findings[0]?.domain).toBe('YAGNI');
      expect(result.output.findings[0]?.severity).toBe('P2');
    });

    it('normalizes inspector recommended pattern aliases', () => {
      const payload = {
        findings: [
          {
            ...validInspectorFinding,
            severity: 'p1',
            architecture: {
              ...validInspectorFinding.architecture,
              recommendedPattern: {
                label: 'Template Method',
                detail:
                  'Lift shared workflow into a template and keep variant hooks isolated.',
              },
            },
          },
        ],
      };

      const result = parseAgentOutput(JSON.stringify(payload), InspectorOutput);
      expect(result.meta.status).toBe('ok');
      expect(
        result.output.findings[0]?.architecture.recommendedPattern.label,
      ).toBe('TEMPLATE_METHOD');
    });

    it('normalizes ports/adapters alias to HEXAGONAL_PORTS_ADAPTERS', () => {
      const payload = {
        findings: [
          {
            ...validInspectorFinding,
            severity: 'p1',
            architecture: {
              ...validInspectorFinding.architecture,
              recommendedPattern: {
                label: 'Ports and Adapters',
                detail:
                  'Separate domain policy from transport and storage concerns via ports.',
              },
            },
          },
        ],
      };

      const result = parseAgentOutput(JSON.stringify(payload), InspectorOutput);
      expect(result.meta.status).toBe('ok');
      expect(
        result.output.findings[0]?.architecture.recommendedPattern.label,
      ).toBe('HEXAGONAL_PORTS_ADAPTERS');
    });
  });

  // -------------------------------------------------------------------------
  // 6. Schema-fail closed behavior
  // -------------------------------------------------------------------------
  describe('schema-fail closed', () => {
    it('returns invalid_output for completely wrong shape', () => {
      const raw = JSON.stringify({ findings: [{ wrong: 'shape' }] });

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('invalid_output');
      expect(result.meta.error).toBeDefined();
      expect(result.output.findings).toEqual([]);
    });

    it('returns invalid_output when findings is not an array', () => {
      const raw = JSON.stringify({ findings: 'not an array' });

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('invalid_output');
      expect(result.output.findings).toEqual([]);
    });

    it('returns invalid_output for totally invalid severity even after normalization', () => {
      const finding = { ...validHunterFinding, severity: 'CRITICAL' };
      const payload = { findings: [finding] };
      const raw = JSON.stringify(payload);

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('invalid_output');
      expect(result.output.findings).toEqual([]);
    });

    it('fails closed for inspector finding without architecture block', () => {
      const payload = {
        findings: [
          {
            domain: 'DESIGN',
            location: 'src/runtime.ts:10',
            severity: 'P1',
            evidence: 'Missing architecture payload should fail.',
            prescription: 'Include architecture block.',
          },
        ],
      };

      const result = parseAgentOutput(JSON.stringify(payload), InspectorOutput);
      expect(result.meta.status).toBe('invalid_output');
      expect(result.output.findings).toEqual([]);
    });

    it('fails closed for unsupported inspector pattern label', () => {
      const payload = {
        findings: [
          {
            ...validInspectorFinding,
            severity: 'p1',
            architecture: {
              ...validInspectorFinding.architecture,
              recommendedPattern: {
                label: 'Totally Unknown Pattern',
                detail:
                  'Non-canonical pattern with unsupported label should fail.',
              },
            },
          },
        ],
      };

      const result = parseAgentOutput(JSON.stringify(payload), InspectorOutput);
      expect(result.meta.status).toBe('invalid_output');
      expect(result.output.findings).toEqual([]);
    });

    it('does not throw on any invalid input', () => {
      const badInputs = [
        '{{{{',
        'null',
        '42',
        '[]',
        'true',
        'random text with no json',
        '{"findings": [{"severity": null}]}',
      ];

      for (const input of badInputs) {
        expect(() => parseAgentOutput(input, HunterOutput)).not.toThrow();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 7. Valid complete output (happy path)
  // -------------------------------------------------------------------------
  describe('valid complete output', () => {
    it('parses a full hunter output with multiple findings', () => {
      const payload = {
        findings: [
          {
            domain: 'BUG',
            location: 'src/api.ts:33',
            severity: 'P0',
            evidence: 'null pointer dereference',
            prescription: 'add null guard',
          },
          {
            domain: 'BUG',
            location: 'src/auth.ts:15',
            severity: 'P1',
            evidence: 'SQL injection via unsanitized input',
            prescription: 'use parameterized queries',
          },
          {
            domain: 'CORRECTNESS',
            location: 'src/calc.ts:99',
            severity: 'P3',
            evidence: 'off-by-one in loop bound',
            prescription: 'change < to <=',
          },
        ],
      };
      const raw = fenced(payload);

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.meta.error).toBeUndefined();
      expect(result.output.findings).toHaveLength(3);
      expect(result.output.findings[0]?.severity).toBe('P0');
      expect(result.output.findings[1]?.domain).toBe('BUG');
      expect(result.output.findings[2]?.location).toBe('src/calc.ts:99');
    });

    it('parses janitor output with all domain types', () => {
      const payload = {
        findings: [
          { ...validJanitorFinding, domain: 'YAGNI' },
          { ...validJanitorFinding, domain: 'DRY', location: 'src/a.ts:1' },
          { ...validJanitorFinding, domain: 'DEAD', location: 'src/b.ts:2' },
        ],
      };
      const raw = JSON.stringify(payload);

      const result = parseAgentOutput(raw, JanitorOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.output.findings.map((f) => f.domain)).toEqual([
        'YAGNI',
        'DRY',
        'DEAD',
      ]);
    });

    it('returns ok for zero findings (clean output)', () => {
      const payload = { findings: [] };
      const raw = fenced(payload);

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('ok');
      expect(result.output.findings).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Partial / malformed JSON
  // -------------------------------------------------------------------------
  describe('partial/malformed JSON', () => {
    it('returns invalid_output for truncated JSON', () => {
      const raw = '{"findings": [{"domain": "BUG", "location": "src/a.ts:1"';

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('invalid_output');
      expect(result.output.findings).toEqual([]);
    });

    it('returns invalid_output for JSON missing required fields', () => {
      const raw = JSON.stringify({
        findings: [{ domain: 'BUG', location: 'src/a.ts:1' }],
      });

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('invalid_output');
      expect(result.output.findings).toEqual([]);
    });

    it('returns invalid_output for text with no JSON at all', () => {
      const raw =
        'I reviewed the code and found no issues. Everything looks good.';

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('invalid_output');
      expect(result.output.findings).toEqual([]);
    });

    it('returns invalid_output for JSON object without findings key', () => {
      const raw = JSON.stringify({ results: [validHunterFinding] });

      const result = parseAgentOutput(raw, HunterOutput);
      // extractJSON requires parsed.findings to be an array — so this returns null
      expect(result.meta.status).toBe('invalid_output');
      expect(result.output.findings).toEqual([]);
    });

    it('handles fenced block with malformed JSON inside', () => {
      const raw = '```json\n{not valid json at all}\n```';

      const result = parseAgentOutput(raw, HunterOutput);
      expect(result.meta.status).toBe('invalid_output');
      expect(result.output.findings).toEqual([]);
    });
  });
});
