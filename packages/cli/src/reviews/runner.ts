import type { OpencodeClient } from '@opencode-ai/sdk';
import type { AgentName } from '@opencode-janitor/shared';

export interface ModelOverride {
  providerID: string;
  modelID: string;
}

export interface CreateReviewSessionOptions {
  title: string;
  directory: string;
}

export interface PromptReviewAsyncOptions {
  sessionId: string;
  directory: string;
  agent: AgentName;
  prompt: string;
  modelOverride?: ModelOverride;
}

export interface FetchAssistantOutputOptions {
  sessionId: string;
  directory: string;
}

/** Parse `provider/model` into SDK override shape. */
export function parseModelOverride(raw: string): ModelOverride | undefined {
  if (!raw) {
    return undefined;
  }

  const slash = raw.indexOf('/');
  if (slash < 1) {
    return undefined;
  }

  return {
    providerID: raw.slice(0, slash),
    modelID: raw.slice(slash + 1),
  };
}

/** Create review session and return session ID. */
export async function createReviewSession(
  client: OpencodeClient,
  options: CreateReviewSessionOptions,
): Promise<string> {
  const response = await client.session.create({
    body: { title: options.title },
    query: { directory: options.directory },
  });

  if (response.error || !response.data?.id) {
    throw new Error(
      `SDK session.create failed: ${JSON.stringify(response.error ?? null)}`,
    );
  }

  return response.data.id;
}

/** Send review prompt asynchronously (fire-and-forget). */
export async function promptReviewAsync(
  client: OpencodeClient,
  options: PromptReviewAsyncOptions,
): Promise<void> {
  const response = await client.session.promptAsync({
    path: { id: options.sessionId },
    query: { directory: options.directory },
    body: {
      agent: options.agent,
      ...(options.modelOverride ? { model: options.modelOverride } : {}),
      parts: [{ type: 'text', text: options.prompt }],
    },
  });

  if (response.error) {
    throw new Error(
      `SDK session.promptAsync failed: ${JSON.stringify(response.error)}`,
    );
  }
}

/** Read assistant text output from persisted session messages. */
export async function fetchAssistantOutput(
  client: OpencodeClient,
  options: FetchAssistantOutputOptions,
): Promise<string> {
  const response = await client.session.messages({
    path: { id: options.sessionId },
    query: { directory: options.directory },
  });

  if (response.error) {
    throw new Error(
      `SDK session.messages failed: ${JSON.stringify(response.error)}`,
    );
  }

  const messages =
    (response.data as
      | Array<{
          info: { role: string };
          parts: Array<{ type: string; text?: string }>;
        }>
      | undefined) ?? [];

  const assistantText: string[] = [];
  for (const message of messages) {
    if (message.info.role !== 'assistant') {
      continue;
    }

    for (const part of message.parts) {
      if (part.type === 'text' && typeof part.text === 'string') {
        assistantText.push(part.text);
      }
    }
  }

  return assistantText.join('\n\n');
}

/** Best-effort abort for an active session. */
export async function abortSession(
  client: OpencodeClient,
  sessionId: string,
  directory: string,
): Promise<void> {
  try {
    await client.session.abort({
      path: { id: sessionId },
      query: { directory },
    });
  } catch {
    // Ignore best-effort abort failures.
  }
}
