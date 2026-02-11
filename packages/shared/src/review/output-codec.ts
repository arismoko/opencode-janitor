/**
 * Unified agent output codec.
 *
 * Single parser for all agent outputs. Extracts JSON from raw LLM text
 * and validates against the agent's Zod schema. Returns structured
 * parse metadata so callers can fail closed on invalid output.
 */
import type { z } from 'zod';
import { AGENTS, type AgentId } from '../agents';
import type { ParseMeta } from '../types/finding';
import type {
  HunterOutput,
  InspectorOutput,
  JanitorOutput,
  ScribeOutput,
} from './finding-schemas';

type AgentOutputById = {
  janitor: JanitorOutput;
  hunter: HunterOutput;
  inspector: InspectorOutput;
  scribe: ScribeOutput;
};

/** Parsed agent output with validation metadata */
export interface ParseResult<T> {
  output: T;
  meta: ParseMeta;
}

/**
 * Parse raw LLM output against a Zod schema.
 *
 * Flow: extract JSON → validate schema → return typed output + status.
 * Never throws — all failures are expressed via meta.status.
 */
export function parseAgentOutput<TAgent extends AgentId>(
  raw: string,
  agent: TAgent,
): ParseResult<AgentOutputById[TAgent]> {
  const schema = AGENTS[agent].outputSchema as z.ZodType<
    AgentOutputById[TAgent]
  >;

  if (!raw.trim()) {
    return {
      output: { findings: [] } as AgentOutputById[TAgent],
      meta: { status: 'empty_output', error: 'No text output from agent' },
    };
  }

  const extracted = extractJSON(raw);
  if (!extracted) {
    return {
      output: { findings: [] } as AgentOutputById[TAgent],
      meta: {
        status: 'invalid_output',
        error: 'No valid JSON found in agent output',
      },
    };
  }

  const parsed = schema.safeParse(extracted);
  if (!parsed.success) {
    // Try lenient: normalize fields and retry
    const normalized = normalizeFindings(extracted);
    const retry = schema.safeParse(normalized);
    if (!retry.success) {
      return {
        output: { findings: [] } as AgentOutputById[TAgent],
        meta: {
          status: 'invalid_output',
          error: `Schema validation failed: ${retry.error.message}`,
        },
      };
    }
    return { output: retry.data, meta: { status: 'ok' } };
  }

  return { output: parsed.data, meta: { status: 'ok' } };
}

/**
 * Normalize finding field values (uppercase enums, trim strings).
 * Handles models that return lowercase severity/domain values.
 */
function normalizeFindings(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  if (!obj.findings || !Array.isArray(obj.findings)) return obj;

  return {
    ...obj,
    findings: obj.findings.map((f: unknown) => {
      if (!f || typeof f !== 'object') return f;
      const finding = f as Record<string, unknown>;
      const normalized: Record<string, unknown> = { ...finding };

      // Uppercase enum fields
      for (const key of ['severity', 'domain']) {
        if (typeof normalized[key] === 'string') {
          normalized[key] = (normalized[key] as string).toUpperCase();
        }
      }

      return normalized;
    }),
  };
}

/**
 * Extract a JSON object from raw text.
 *
 * Handles: fenced code blocks, bare JSON, multiple JSON objects
 * (e.g. from resumed sessions that produced output twice).
 */
function extractJSON(raw: string): Record<string, unknown> | null {
  // Try fenced code block: ```json ... ``` or ``` ... ```
  // Use greedy match to find the LAST fenced block (most likely the final output)
  const fencedMatches = [
    ...raw.matchAll(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g),
  ];
  for (let i = fencedMatches.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(fencedMatches[i][1].trim());
      if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray(parsed.findings)
      ) {
        return parsed;
      }
    } catch {
      // Try next match
    }
  }

  // Try bare JSON — find matching brace pairs from right to left.
  // Scanning from the end handles double-output from resumed sessions.
  // String-aware: braces inside JSON string values don't affect depth.
  let depth = 0;
  let end = -1;
  let inString = false;
  for (let i = raw.length - 1; i >= 0; i--) {
    const ch = raw[i];

    if (ch === '"') {
      let backslashes = 0;
      for (let j = i - 1; j >= 0 && raw[j] === '\\'; j--) {
        backslashes++;
      }
      if (backslashes % 2 === 0) {
        inString = !inString;
      }
      continue;
    }

    if (inString) continue;

    if (ch === '}') {
      if (depth === 0) end = i;
      depth++;
    } else if (ch === '{') {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && end !== -1) {
        try {
          const parsed = JSON.parse(raw.slice(i, end + 1));
          if (
            parsed &&
            typeof parsed === 'object' &&
            Array.isArray(parsed.findings)
          ) {
            return parsed;
          }
        } catch {
          end = -1;
        }
      }
    }
  }

  return null;
}
