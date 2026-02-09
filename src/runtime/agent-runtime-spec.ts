/**
 * Lightweight agent runtime spec — captures per-agent differences as data
 * so a single generic executor factory replaces duplicated inline closures.
 *
 * This is NOT a heavy registry. It's a small internal type that centralizes
 * the agent-specific pieces of run preparation: context resolution, prompt
 * metadata, agent identity, and session tracking.
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import type { ReviewContext } from '../review/prompt-builder';
import type { SpawnReviewOpts } from '../review/runner';
import type { Exec } from './runtime-types';

/**
 * Per-agent runtime spec.
 *
 * TContext is the queue's context type (string for janitor, PrContext for hunter).
 * The spec knows how to turn a raw queue context into a ReviewContext for prompt
 * building and SpawnReviewOpts for session spawning.
 */
export interface AgentRuntimeSpec<TContext> {
  /** Agent name registered in the config hook (e.g. 'janitor', 'bug-hunter') */
  readonly agent: string;
  /** Queue tag for logging (e.g. 'janitor', 'hunter') */
  readonly queueTag: string;
  /** Resolve the model ID for this agent from config */
  resolveModelId(config: JanitorConfig): string | undefined;
  /**
   * Prepare a review context from the raw queue context.
   * Handles context resolution (git operations), suppressions, etc.
   */
  prepareReviewContext(
    runKey: TContext,
    config: JanitorConfig,
    exec: Exec,
  ): Promise<PreparedContext>;
  /** Build the session title from the run key */
  sessionTitle(runKey: TContext): string;
}

/**
 * The output of context preparation — everything needed to build a prompt
 * and spawn a review session.
 */
export interface PreparedContext {
  /** Review context for the prompt builder */
  reviewContext: ReviewContext;
  /** Optional suppressions block (janitor only) */
  suppressionsBlock?: string;
}

/**
 * Build SpawnReviewOpts from a spec and prepared context.
 * Centralizes the common pattern of mapping spec + prompt → spawn opts.
 */
function buildSpawnOpts<TContext>(
  spec: AgentRuntimeSpec<TContext>,
  runKey: TContext,
  prompt: string,
  config: JanitorConfig,
  parentID?: string,
): SpawnReviewOpts {
  return {
    prompt,
    title: spec.sessionTitle(runKey),
    agent: spec.agent,
    modelId: spec.resolveModelId(config),
    parentID,
  };
}

/**
 * Create a generic executor from a runtime spec.
 *
 * Replaces the duplicated inline closures in agent-runtime.ts with a single
 * factory that uses the spec to resolve context, build prompts, spawn sessions,
 * and track metadata.
 */
export function createSpecExecutor<TContext>(
  spec: AgentRuntimeSpec<TContext>,
  deps: {
    ctx: PluginInput;
    config: JanitorConfig;
    exec: Exec;
    trackedSessions: Set<string>;
    writeSessionMeta: (
      sessionId: string,
      meta: {
        title: string;
        agent: string;
        key: string;
        status: string;
        startedAt: number;
      },
    ) => void;
    buildPrompt: (
      reviewContext: ReviewContext,
      promptConfig: {
        maxFindings: number;
        scopeInclude: string[];
        scopeExclude: string[];
        suppressionsBlock?: string;
      },
    ) => string;
    spawnReview: (ctx: PluginInput, opts: SpawnReviewOpts) => Promise<string>;
    extractKey: (context: TContext) => string;
  },
): (context: TContext, parentSessionId?: string) => Promise<string> {
  const { ctx, config, exec, trackedSessions, writeSessionMeta } = deps;

  return async (
    context: TContext,
    parentSessionId?: string,
  ): Promise<string> => {
    const prepared = await spec.prepareReviewContext(context, config, exec);

    const prompt = deps.buildPrompt(prepared.reviewContext, {
      maxFindings: config.model.maxFindings,
      scopeInclude: config.scope.include,
      scopeExclude: config.scope.exclude,
      suppressionsBlock: prepared.suppressionsBlock,
    });

    const spawnOpts = buildSpawnOpts(
      spec,
      context,
      prompt,
      config,
      parentSessionId,
    );
    const sessionId = await deps.spawnReview(ctx, spawnOpts);

    const key = deps.extractKey(context);
    const title = spec.sessionTitle(context);
    trackedSessions.add(sessionId);
    writeSessionMeta(sessionId, {
      title,
      agent: spec.agent,
      key,
      status: 'running',
      startedAt: Date.now(),
    });

    return sessionId;
  };
}
