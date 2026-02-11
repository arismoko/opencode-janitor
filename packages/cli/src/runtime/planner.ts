import type { Database } from 'bun:sqlite';
import {
  AGENTS,
  type AgentId,
  isScopeId,
  SCOPES,
  type ScopeId,
  TRIGGERS,
  type TriggerId,
} from '@opencode-janitor/shared';
import type { CliConfig } from '../config/schema';
import { enqueueReviewRun } from '../db/queries/review-run-queries';
import {
  getTriggerEventById,
  listTriggerEventsWithoutRuns,
} from '../db/queries/trigger-event-queries';

type ManualPayload = {
  agent?: AgentId;
  requestedScope?: ScopeId;
  input?: Record<string, unknown>;
  hasWorkspaceDiff?: boolean;
};

function parseManualPayload(payloadJson: string): ManualPayload {
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    const payload: ManualPayload = {};

    if (typeof parsed.agent === 'string' && parsed.agent in AGENTS) {
      payload.agent = parsed.agent as AgentId;
    }

    if (
      typeof parsed.requestedScope === 'string' &&
      isScopeId(parsed.requestedScope)
    ) {
      payload.requestedScope = parsed.requestedScope;
    }

    if (typeof parsed.hasWorkspaceDiff === 'boolean') {
      payload.hasWorkspaceDiff = parsed.hasWorkspaceDiff;
    }

    if (
      typeof parsed.input === 'object' &&
      parsed.input !== null &&
      !Array.isArray(parsed.input)
    ) {
      payload.input = parsed.input as Record<string, unknown>;
    }

    return payload;
  } catch {
    return {};
  }
}

function resolveScope(
  triggerId: TriggerId,
  agentId: AgentId,
  payloadJson: string,
): { scope: ScopeId; input: Record<string, unknown> } | null {
  const trigger = TRIGGERS[triggerId];
  const agent = AGENTS[agentId];

  if (triggerId !== 'manual') {
    const scope = trigger.defaultScope;
    if (!scope) {
      return null;
    }

    return { scope, input: {} };
  }

  const manual = parseManualPayload(payloadJson);
  const scope = agent.resolveManualScope({
    requestedScope: manual.requestedScope,
    hasWorkspaceDiff: manual.hasWorkspaceDiff ?? false,
    manualInput: manual.input,
    trigger: 'manual',
  });

  if (!agent.capabilities.manualScopes.includes(scope)) {
    return null;
  }
  const allowedScopes = trigger.allowedScopes as readonly ScopeId[];
  if (!allowedScopes.includes(scope)) {
    return null;
  }

  const input = manual.input ?? {};
  const scopeDefinition = SCOPES[scope];
  if (scopeDefinition.inputSchema) {
    const parsed = scopeDefinition.inputSchema.safeParse(input);
    if (!parsed.success) {
      return null;
    }
    return {
      scope,
      input: parsed.data as Record<string, unknown>,
    };
  }

  return { scope, input };
}

function isAutoEligible(
  config: CliConfig,
  agentId: AgentId,
  triggerId: TriggerId,
): boolean {
  if (triggerId === 'manual') {
    return false;
  }

  const agentConfig = config.agents[agentId];
  return (
    agentConfig.enabled &&
    agentConfig.autoTriggers.includes(triggerId) &&
    AGENTS[agentId].capabilities.autoTriggers.includes(triggerId)
  );
}

export function planReviewRunsForEvent(
  db: Database,
  config: CliConfig,
  eventId: string,
): { planned: number } {
  const event = getTriggerEventById(db, eventId);
  if (!event) {
    return { planned: 0 };
  }

  const triggerId = event.trigger_id;
  const manualPayload =
    triggerId === 'manual' ? parseManualPayload(event.payload_json) : {};

  let planned = 0;
  for (const [agentId, definition] of Object.entries(AGENTS) as [
    AgentId,
    (typeof AGENTS)[AgentId],
  ][]) {
    const agentConfig = config.agents[agentId];
    if (!agentConfig.enabled) {
      continue;
    }

    if (triggerId === 'manual') {
      if (manualPayload.agent && manualPayload.agent !== agentId) {
        continue;
      }
    } else if (!isAutoEligible(config, agentId, triggerId)) {
      continue;
    }

    const resolved = resolveScope(triggerId, agentId, event.payload_json);
    if (!resolved) {
      continue;
    }

    const result = enqueueReviewRun(db, {
      repoId: event.repo_id,
      triggerEventId: event.id,
      agent: definition.id,
      scope: resolved.scope,
      scopeInputJson: JSON.stringify(resolved.input),
      maxAttempts: config.scheduler.maxAttempts,
    });

    if (result.inserted) {
      planned++;
    }
  }

  return { planned };
}

export function planPendingReviewRuns(
  db: Database,
  config: CliConfig,
  limit = 200,
): { scanned: number; planned: number } {
  const events = listTriggerEventsWithoutRuns(db, limit);
  let planned = 0;

  for (const event of events) {
    planned += planReviewRunsForEvent(db, config, event.id).planned;
  }

  return {
    scanned: events.length,
    planned,
  };
}
