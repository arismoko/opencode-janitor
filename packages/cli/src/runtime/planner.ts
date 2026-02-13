import type { Database } from 'bun:sqlite';
import {
  AGENTS,
  type AgentId,
  isScopeId,
  MANUAL_TRIGGER_DEFINITION,
  SCOPES,
  type ScopeId,
  TRIGGERS,
  type TriggerId,
} from '@opencode-janitor/shared';
import type { CliConfig } from '../config/schema';
import { enqueueReviewRun } from '../db/queries/review-run-queries';
import { getTriggerEventById } from '../db/queries/trigger-event-queries';
import { canAgentPlanForEvent } from './agent-eligibility-policy';

/**
 * Parse a stored manual payload JSON string using the shared schema.
 * Returns a partial payload on success, or `{}` on any failure.
 */
function parseManualPayload(payloadJson: string) {
  try {
    const raw = JSON.parse(payloadJson);
    const result = MANUAL_TRIGGER_DEFINITION.payloadSchema.safeParse(raw);
    return result.success ? result.data : {};
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
  const requestedScope = manual.requestedScope;
  if (typeof requestedScope !== 'string') {
    return null;
  }
  if (!isScopeId(requestedScope)) {
    return null;
  }
  const scope = requestedScope;

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
    const eligibility = canAgentPlanForEvent(
      config,
      agentId,
      triggerId,
      manualPayload,
    );
    if (!eligibility.eligible) {
      if (config.daemon.logLevel === 'debug') {
        console.debug(
          `[planner] skip agent=${agentId} trigger=${triggerId} event=${event.id}: ${eligibility.reason ?? 'ineligible'}`,
        );
      }
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
