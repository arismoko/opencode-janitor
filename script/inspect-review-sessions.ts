#!/usr/bin/env bun

/**
 * Inspect janitor/reviewer session state from the XDG state directory.
 *
 * Usage:
 *   bun script/inspect-review-sessions.ts              # list sessions
 *   bun script/inspect-review-sessions.ts --follow <id> # tail JSONL events
 *   bun script/inspect-review-sessions.ts --dump <id>   # dump full JSONL
 *   bun script/inspect-review-sessions.ts --all         # include completed
 */

import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveStateDir } from '../src/utils/state-dir';

// ── Types ──

type SessionMeta = {
  id: string;
  title: string;
  agent: string;
  key: string;
  status: string;
  startedAt: number;
  completedAt?: number;
  workspaceDir: string;
};

type SseEvent = {
  _ts: number;
  type: string;
  properties?: Record<string, unknown>;
};

type PartPayload = {
  type: string;
  sessionID: string;
  text?: string;
  tool?: string;
  state?: {
    status: string;
    title?: string;
    error?: string;
  };
};

// ── CLI helpers ──

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith('--')) return undefined;
  return value;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

// ── Formatting ──

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function fmtAge(ts?: number): string {
  if (!ts) return '-';
  const delta = Date.now() - ts;
  if (delta < 0) return 'now';
  const secs = Math.floor(delta / 1_000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function pad(s: string, len: number): string {
  return s.padEnd(len);
}

// ── Follow mode ──

async function followSession(
  stateDir: string,
  sessionId: string,
): Promise<void> {
  const metaPath = join(stateDir, `${sessionId}.json`);
  const jsonlPath = join(stateDir, `${sessionId}.jsonl`);

  if (!existsSync(metaPath)) {
    console.error(`Session ${sessionId} not found in ${stateDir}`);
    process.exit(1);
  }

  const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as SessionMeta;
  console.log(
    `${BOLD}following${RESET} ${meta.title} ${DIM}(${sessionId})${RESET}\n`,
  );

  // Read existing lines
  let offset = 0;
  if (existsSync(jsonlPath)) {
    const existing = readFileSync(jsonlPath, 'utf-8');
    const lines = existing.split('\n').filter(Boolean);
    for (const line of lines) {
      renderEvent(JSON.parse(line) as SseEvent);
    }
    offset = existsSync(jsonlPath) ? statSync(jsonlPath).size : 0;
  }

  // Tail new lines
  const file = Bun.file(jsonlPath);
  const debug = hasFlag('--debug');

  // Poll for new content (Bun doesn't have native file tailing)
  const POLL_MS = 100;
  let idle = false;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!existsSync(jsonlPath)) {
      await Bun.sleep(POLL_MS);
      continue;
    }

    const stat = statSync(jsonlPath);
    if (stat.size > offset) {
      // Read only the new bytes
      const buf = Buffer.alloc(stat.size - offset);
      const fd = openSync(jsonlPath, 'r');
      readSync(fd, buf, 0, buf.length, offset);
      closeSync(fd);
      offset = stat.size;

      const chunk = buf.toString('utf-8');
      const lines = chunk.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const event = JSON.parse(line) as SseEvent;
          if (debug) {
            process.stderr.write(`${DIM}[event] ${event.type}${RESET}\n`);
          }
          renderEvent(event);

          // Stop on session idle/error
          if (event.type === 'session.idle' || event.type === 'session.error') {
            return;
          }
        } catch {
          // Partial line — will be completed on next poll
        }
      }
      idle = false;
    } else {
      // Check if session completed while we were waiting
      if (!idle) {
        try {
          const freshMeta = JSON.parse(
            readFileSync(metaPath, 'utf-8'),
          ) as SessionMeta;
          if (
            freshMeta.status === 'completed' ||
            freshMeta.status === 'failed'
          ) {
            process.stderr.write(
              `\n${GREEN}○ session ${freshMeta.status}${RESET}\n`,
            );
            return;
          }
        } catch {
          // ignore
        }
      }
      idle = true;
      await Bun.sleep(POLL_MS);
    }
  }
}

let lastPartText = '';
let lastReasoningText = '';
let inReasoning = false;

function renderEvent(event: SseEvent): void {
  switch (event.type) {
    case 'session.status': {
      const status = event.properties?.status as { type: string } | undefined;
      if (status?.type === 'busy') {
        // skip — too noisy
      } else if (status?.type === 'retry') {
        const s = event.properties?.status as {
          type: string;
          attempt: number;
          message: string;
        };
        process.stderr.write(
          `${YELLOW}⟳ retry #${s.attempt}: ${s.message}${RESET}\n`,
        );
      } else if (status?.type === 'idle') {
        process.stderr.write(`\n${GREEN}○ session idle${RESET}\n`);
      }
      break;
    }

    case 'message.part.updated': {
      const part = event.properties?.part as PartPayload | undefined;
      const delta = event.properties?.delta as string | undefined;
      if (!part) break;

      if (part.type === 'text') {
        if (inReasoning) {
          // Close reasoning block before text starts
          process.stderr.write(`${RESET}\n`);
          inReasoning = false;
          lastReasoningText = '';
        }
        if (delta) {
          process.stdout.write(delta);
        } else if (part.text && part.text !== lastPartText) {
          const newText = part.text.slice(lastPartText.length);
          if (newText) process.stdout.write(newText);
        }
        lastPartText = part.text ?? '';
      } else if (part.type === 'reasoning') {
        if (!inReasoning) {
          process.stderr.write(`${DIM}`);
          inReasoning = true;
        }
        if (delta) {
          process.stderr.write(delta);
        } else if (part.text && part.text !== lastReasoningText) {
          const newText = part.text.slice(lastReasoningText.length);
          if (newText) process.stderr.write(newText);
        }
        lastReasoningText = part.text ?? '';
      } else if (part.type === 'tool') {
        const state = part.state;
        if (!state) break;
        const toolLabel = `${DIM}${part.tool}${RESET}`;

        if (state.status === 'completed') {
          process.stderr.write(
            `${GREEN}✓ ${toolLabel} ${state.title ?? ''}${RESET}\n`,
          );
        } else if (state.status === 'error') {
          process.stderr.write(
            `${RED}✗ ${toolLabel} ${state.error ?? 'failed'}${RESET}\n`,
          );
        }
      } else if (part.type === 'step-start') {
        lastPartText = '';
        // skip step markers — too noisy
      } else if (part.type === 'step-finish') {
        // newline after text block ends
        process.stdout.write('\n');
      }
      break;
    }

    case 'session.error': {
      const err = event.properties?.error as { message?: string } | undefined;
      process.stderr.write(
        `\n${RED}✗ session error: ${err?.message ?? 'unknown'}${RESET}\n`,
      );
      break;
    }
  }
}

// ── Dump mode ──

function dumpSession(stateDir: string, sessionId: string): void {
  const jsonlPath = join(stateDir, `${sessionId}.jsonl`);
  if (!existsSync(jsonlPath)) {
    console.error(`No event log for session ${sessionId}`);
    process.exit(1);
  }
  process.stdout.write(readFileSync(jsonlPath, 'utf-8'));
}

// ── List mode ──

type Row = { id: string; status: string; age: string; title: string };

function printTable(rows: Row[]): void {
  if (rows.length === 0) {
    console.log('  (no sessions)');
    return;
  }

  const colW = {
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    age: Math.max(3, ...rows.map((r) => r.age.length)),
  };

  const header = `  ${pad('ID', colW.id)}  ${pad('STATUS', colW.status)}  ${pad('AGE', colW.age)}  TITLE`;
  const rule = `  ${'─'.repeat(colW.id)}  ${'─'.repeat(colW.status)}  ${'─'.repeat(colW.age)}  ${'─'.repeat(20)}`;

  console.log(header);
  console.log(rule);
  for (const r of rows) {
    const statusColor =
      r.status === 'running'
        ? CYAN
        : r.status === 'completed'
          ? GREEN
          : r.status === 'failed'
            ? RED
            : '';
    console.log(
      `  ${pad(r.id, colW.id)}  ${statusColor}${pad(r.status, colW.status)}${RESET}  ${pad(r.age, colW.age)}  ${r.title}`,
    );
  }
}

// ── Main ──

async function main(): Promise<void> {
  const stateDir = resolveStateDir(process.cwd());
  const followId = argValue('--follow');
  const dumpId = argValue('--dump');
  const showAll = hasFlag('--all');

  if (!existsSync(stateDir)) {
    console.error(
      `No state directory found at ${stateDir}\nIs the janitor plugin running for this project?`,
    );
    process.exit(1);
  }

  if (followId) {
    await followSession(stateDir, followId);
    return;
  }

  if (dumpId) {
    dumpSession(stateDir, dumpId);
    return;
  }

  // List sessions
  const files = await readdir(stateDir);
  const metaFiles = files.filter(
    (f) => f.endsWith('.json') && !f.endsWith('.jsonl'),
  );

  const sessions: SessionMeta[] = [];
  for (const f of metaFiles) {
    try {
      sessions.push(
        JSON.parse(readFileSync(join(stateDir, f), 'utf-8')) as SessionMeta,
      );
    } catch {
      // skip corrupt files
    }
  }

  const filtered = showAll
    ? sessions
    : sessions.filter((s) => s.status === 'running');

  // Sort by startedAt desc
  filtered.sort((a, b) => b.startedAt - a.startedAt);

  const janitorRows: Row[] = [];
  const reviewerRows: Row[] = [];

  for (const s of filtered) {
    const row: Row = {
      id: s.id,
      status: s.status,
      age: fmtAge(s.startedAt),
      title: s.title,
    };

    if (s.agent === 'janitor') janitorRows.push(row);
    else reviewerRows.push(row);
  }

  console.log(`\n  ${filtered.length} session(s)\n`);

  if (janitorRows.length > 0) {
    console.log('  ── Janitor ──');
    printTable(janitorRows);
    console.log();
  }

  if (reviewerRows.length > 0) {
    console.log('  ── Reviewer ──');
    printTable(reviewerRows);
    console.log();
  }

  if (janitorRows.length === 0 && reviewerRows.length === 0) {
    console.log(
      showAll
        ? '  No sessions found.'
        : '  No running sessions. Use --all to see completed.',
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
