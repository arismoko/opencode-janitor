#!/usr/bin/env bun

import { createOpencodeClient } from '@opencode-ai/sdk';

type RuntimeStatus = 'idle' | 'busy' | 'retry' | 'unknown';

type SessionInfo = {
  id: string;
  title?: string;
  updated?: number;
  created?: number;
};

type ToolCall = {
  messageId: string;
  tool: string;
  status: string;
  created?: number;
  description?: string;
  command?: string;
};

const REVIEW_TITLE_PREFIXES = ['[janitor-run] ', '[reviewer-run] '];

function argHas(flag: string): boolean {
  return process.argv.includes(flag);
}

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx < 0) return undefined;
  return process.argv[idx + 1];
}

function fmtTime(ts?: number): string {
  if (!ts) return '-';
  return new Date(ts).toISOString();
}

function isReviewTitle(title?: string): boolean {
  if (!title) return false;
  return REVIEW_TITLE_PREFIXES.some((prefix) => title.startsWith(prefix));
}

async function getStatusMap(
  client: ReturnType<typeof createOpencodeClient>,
  directory: string,
): Promise<Record<string, RuntimeStatus>> {
  const result = await client.session.status({ query: { directory } });
  const raw = ((result as { data?: Record<string, { type?: string }> }).data ??
    {}) as Record<string, { type?: string }>;
  const out: Record<string, RuntimeStatus> = {};
  for (const [sessionId, status] of Object.entries(raw)) {
    const type = status?.type;
    out[sessionId] =
      type === 'busy' || type === 'idle' || type === 'retry' ? type : 'unknown';
  }
  return out;
}

async function collectToolCalls(
  client: ReturnType<typeof createOpencodeClient>,
  directory: string,
  sessionId: string,
): Promise<ToolCall[]> {
  const result = await client.session.messages({
    path: { id: sessionId },
    query: { directory },
  });

  const messages = ((result as { data?: unknown[] }).data ?? []) as Array<{
    info?: { id?: string; time?: { created?: number } };
    parts?: Array<{
      type?: string;
      tool?: string;
      state?: {
        status?: string;
        input?: { description?: string; command?: string };
      };
    }>;
  }>;

  const calls: ToolCall[] = [];
  for (const message of messages) {
    const messageId = message.info?.id;
    if (!messageId) continue;
    for (const part of message.parts ?? []) {
      if (part.type !== 'tool') continue;
      calls.push({
        messageId,
        tool: part.tool ?? '<unknown>',
        status: part.state?.status ?? '<unknown>',
        created: message.info?.time?.created,
        description: part.state?.input?.description,
        command: part.state?.input?.command,
      });
    }
  }
  return calls;
}

async function main(): Promise<void> {
  const directory = argValue('--directory') ?? process.cwd();
  const serverUrl = argValue('--server-url') ?? 'http://127.0.0.1:4096';
  const showAll = argHas('--all');
  const onlySession = argValue('--session');

  const client = createOpencodeClient({ baseUrl: serverUrl });

  const listResult = await client.session.list({
    query: { directory },
  });
  const sessions = ((listResult as { data?: unknown[] }).data ?? []) as Array<{
    id?: string;
    title?: string;
    time?: { updated?: number; created?: number };
  }>;

  const statusMap = await getStatusMap(client, directory);

  const rows = sessions
    .filter((session) => session.id && isReviewTitle(session.title))
    .filter((session) => !onlySession || session.id === onlySession)
    .map((session) => {
      const id = session.id as string;
      const status = statusMap[id] ?? 'idle';
      return {
        session: {
          id,
          title: session.title,
          updated: session.time?.updated,
          created: session.time?.created,
        } as SessionInfo,
        status,
        running: status === 'busy' || status === 'retry',
      };
    })
    .sort((a, b) => (b.session.updated ?? 0) - (a.session.updated ?? 0));

  const filtered = showAll ? rows : rows.filter((row) => row.running);

  console.log(`Server:    ${serverUrl}`);
  console.log(`Directory: ${directory}`);
  console.log(
    `Sessions:  ${filtered.length}${showAll ? ` (of ${rows.length} review sessions)` : ' active review session(s)'}`,
  );

  for (const row of filtered) {
    console.log('');
    console.log(`- ${row.session.id}`);
    console.log(`  title:    ${row.session.title ?? '-'}`);
    console.log(
      `  status:   ${row.running ? 'running' : 'idle'} (${row.status})`,
    );
    console.log(`  updated:  ${fmtTime(row.session.updated)}`);
    console.log(`  created:  ${fmtTime(row.session.created)}`);

    const calls = await collectToolCalls(client, directory, row.session.id);
    if (calls.length === 0) {
      console.log('  tools:    none');
      continue;
    }

    console.log('  tool-calls:');
    for (const call of calls) {
      const summary = call.command ?? call.description ?? '';
      const suffix = summary ? ` | ${summary}` : '';
      console.log(
        `    - ${fmtTime(call.created)} | ${call.messageId} | ${call.tool} | ${call.status}${suffix}`,
      );
    }
  }

  if (filtered.length === 0) {
    console.log('');
    console.log(
      showAll
        ? 'No review sessions found.'
        : 'No active review sessions found. Use --all to inspect recent completed ones.',
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
