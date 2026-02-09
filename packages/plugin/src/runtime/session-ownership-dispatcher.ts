/**
 * Session ownership dispatcher — routes terminal session events to the
 * owning queue without broadcast lookups.
 *
 * Each queue registers `sessionID → owner` at spawn time. When a
 * `session.completed` or `session.error` event arrives, the dispatcher
 * resolves the owner in O(1) and delegates directly, guaranteeing that
 * queue slot release is both targeted and consistent.
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { JanitorConfig } from '../config/schema';
import { warn } from '../utils/logger';

/** Minimum contract a queue must satisfy to own sessions. */
export interface SessionOwner {
  handleCompletion(
    sessionId: string,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<void>;
  handleFailure(sessionId: string, error: string): void;
}

/**
 * Maps sessionID → owning queue for targeted event routing.
 */
export class SessionOwnershipDispatcher {
  private readonly owners = new Map<string, SessionOwner>();

  /** Register a session as owned by the given queue. */
  register(sessionId: string, owner: SessionOwner): void {
    this.owners.set(sessionId, owner);
  }

  /** Remove ownership tracking for a session. */
  release(sessionId: string): void {
    this.owners.delete(sessionId);
  }

  /**
   * Route a completion event to the owning queue.
   * Returns true if an owner was found and notified.
   */
  async resolveCompletion(
    sessionId: string,
    ctx: PluginInput,
    config: JanitorConfig,
  ): Promise<boolean> {
    const owner = this.owners.get(sessionId);
    if (!owner) return false;

    try {
      await owner.handleCompletion(sessionId, ctx, config);
    } catch (err) {
      warn(`[dispatcher] completion handler threw for ${sessionId}: ${err}`);
    }
    return true;
  }

  /**
   * Route a failure event to the owning queue.
   * Returns true if an owner was found and notified.
   */
  resolveFailure(sessionId: string, error: string): boolean {
    const owner = this.owners.get(sessionId);
    if (!owner) return false;

    owner.handleFailure(sessionId, error);
    return true;
  }

  /** Check if a session is tracked. */
  has(sessionId: string): boolean {
    return this.owners.has(sessionId);
  }
}
