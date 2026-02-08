#!/usr/bin/env bun

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpencode } from '@opencode-ai/sdk';

type SessionRow = {
  id: string;
  title?: string;
  time?: {
    created?: number;
    updated?: number;
  };
};

type SessionStatus =
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; attempt: number; message: string; next: number };

const JANITOR_PREFIX = '[janitor-run]';
const REVIEWER_CODE_REVIEW_TITLE = '[reviewer-run] Code Review';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = join(SCRIPT_DIR, 'artifacts');

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

const STATUS_BADGE: Record<string, string> = {
  idle: '○ idle',
  busy: '● busy',
  retry: '⟳ retry',
};

function fmtStatus(status?: SessionStatus): string {
  if (!status) return '· done';
  const badge = STATUS_BADGE[status.type] ?? status.type;
  if (status.type === 'retry') return `${badge}(${status.attempt})`;
  return badge;
}

function fmtAge(ts?: number): string {
  if (!ts) return '-';
  const delta = Date.now() - ts;
  if (delta < 0) return 'just now';
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

function shouldShowSession(title?: string): boolean {
  if (!title) return false;
  return (
    title.startsWith(JANITOR_PREFIX) || title === REVIEWER_CODE_REVIEW_TITLE
  );
}

function printTable(
  rows: { id: string; status: string; age: string; title: string }[],
): void {
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
    console.log(
      `  ${pad(r.id, colW.id)}  ${pad(r.status, colW.status)}  ${pad(r.age, colW.age)}  ${r.title}`,
    );
  }
}

// ── Main ──

async function main(): Promise<void> {
  const dumpSessionId = argValue('--dump');
  const showAll = hasFlag('--all');
  const { client, server } = await createOpencode();

  try {
    if (dumpSessionId) {
      const session = (
        await client.session.get({ path: { id: dumpSessionId } })
      ).data;
      const messages = (
        await client.session.messages({ path: { id: dumpSessionId } })
      ).data;
      const payload = { session, messages };
      const json = JSON.stringify(payload, null, 2);
      const artifactPath = join(
        ARTIFACTS_DIR,
        `session-${dumpSessionId}.full.json`,
      );

      await mkdir(ARTIFACTS_DIR, { recursive: true });
      await writeFile(artifactPath, `${json}\n`, 'utf8');
      console.error(`artifact=${artifactPath}`);
      console.log(json);
      return;
    }

    // Fetch sessions and status in parallel
    const [listResult, statusResult] = await Promise.all([
      client.session.list(),
      client.session.status(),
    ]);

    const sessions = ((listResult as { data?: unknown[] }).data ??
      []) as SessionRow[];
    const statusMap = ((statusResult as { data?: unknown }).data ??
      {}) as Record<string, SessionStatus>;

    const filtered = showAll
      ? sessions
      : sessions.filter((s) => shouldShowSession(s.title));

    // Split into janitor vs reviewer groups
    const janitorRows: {
      id: string;
      status: string;
      age: string;
      title: string;
    }[] = [];
    const reviewerRows: {
      id: string;
      status: string;
      age: string;
      title: string;
    }[] = [];
    const otherRows: {
      id: string;
      status: string;
      age: string;
      title: string;
    }[] = [];

    for (const s of filtered) {
      const row = {
        id: s.id,
        status: fmtStatus(statusMap[s.id]),
        age: fmtAge(s.time?.updated),
        title: s.title ?? '(untitled)',
      };

      if (s.title?.startsWith(JANITOR_PREFIX)) janitorRows.push(row);
      else if (s.title === REVIEWER_CODE_REVIEW_TITLE) reviewerRows.push(row);
      else otherRows.push(row);
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

    if (otherRows.length > 0) {
      console.log('  ── Other ──');
      printTable(otherRows);
      console.log();
    }
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
