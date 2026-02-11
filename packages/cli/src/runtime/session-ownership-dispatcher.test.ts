import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { SessionOwnershipDispatcher } from './session-ownership-dispatcher';

describe('SessionOwnershipDispatcher', () => {
  let dispatcher: SessionOwnershipDispatcher;

  beforeEach(() => {
    dispatcher = new SessionOwnershipDispatcher();
  });

  afterEach(() => {
    // Clean up any pending sessions to avoid dangling timers.
    dispatcher.cancelAll('test cleanup');
  });

  // ── Idempotent register ──────────────────────────────────────────────

  it('returns the same promise when registering the same session ID twice', () => {
    const opts = { directory: '/tmp/a', timeoutMs: 5_000 };
    const first = dispatcher.register('s1', opts);
    const second = dispatcher.register('s1', opts);

    expect(first).toBe(second);
  });

  it('does not lose data on duplicate register', async () => {
    const opts = { directory: '/tmp/a', timeoutMs: 5_000 };
    const first = dispatcher.register('s1', opts);
    const second = dispatcher.register('s1', opts);

    // Both references point to the same promise, so one resolve settles both.
    dispatcher.resolve('s1', { type: 'idle' });

    const [r1, r2] = await Promise.all([first, second]);
    expect(r1).toEqual({ type: 'idle' });
    expect(r2).toEqual({ type: 'idle' });
  });

  // ── Normal completion ────────────────────────────────────────────────

  it('resolves waiters with the provided outcome', async () => {
    const promise = dispatcher.register('s1', {
      directory: '/tmp/a',
      timeoutMs: 5_000,
    });

    const resolved = dispatcher.resolve('s1', { type: 'idle' });
    expect(resolved).toBe(true);

    const outcome = await promise;
    expect(outcome).toEqual({ type: 'idle' });
  });

  it('resolves with error outcome', async () => {
    const promise = dispatcher.register('s1', {
      directory: '/tmp/a',
      timeoutMs: 5_000,
    });

    dispatcher.resolve('s1', { type: 'error', message: 'boom' });

    const outcome = await promise;
    expect(outcome).toEqual({ type: 'error', message: 'boom' });
  });

  // ── Timeout resolution ───────────────────────────────────────────────

  it('resolves with timeout outcome when timeoutMs elapses', async () => {
    const promise = dispatcher.register('s1', {
      directory: '/tmp/a',
      timeoutMs: 50,
    });

    const outcome = await promise;
    expect(outcome.type).toBe('timeout');
    expect((outcome as { message: string }).message).toContain('s1');
    expect((outcome as { message: string }).message).toContain('timeout');
  });

  it('clears timeout when resolved before expiry', async () => {
    const promise = dispatcher.register('s1', {
      directory: '/tmp/a',
      timeoutMs: 100,
    });

    dispatcher.resolve('s1', { type: 'idle' });

    const outcome = await promise;
    expect(outcome.type).toBe('idle');
  });

  // ── Cancel ───────────────────────────────────────────────────────────

  it('cancels a pending session with a cancelled outcome', async () => {
    const promise = dispatcher.register('s1', {
      directory: '/tmp/a',
      timeoutMs: 5_000,
    });

    const cancelled = dispatcher.cancel('s1', 'user cancelled');
    expect(cancelled).toBe(true);

    const outcome = await promise;
    expect(outcome).toEqual({ type: 'cancelled', message: 'user cancelled' });
  });

  it('returns false when cancelling an unknown session', () => {
    expect(dispatcher.cancel('unknown', 'nope')).toBe(false);
  });

  // ── cancelAll ────────────────────────────────────────────────────────

  it('cancels all pending sessions and returns their IDs', async () => {
    const p1 = dispatcher.register('s1', {
      directory: '/tmp/a',
      timeoutMs: 5_000,
    });
    const p2 = dispatcher.register('s2', {
      directory: '/tmp/b',
      timeoutMs: 5_000,
    });
    const p3 = dispatcher.register('s3', {
      directory: '/tmp/a',
      timeoutMs: 5_000,
    });

    const ids = dispatcher.cancelAll('shutdown');
    expect(ids).toHaveLength(3);
    expect(ids).toContain('s1');
    expect(ids).toContain('s2');
    expect(ids).toContain('s3');

    const outcomes = await Promise.all([p1, p2, p3]);
    for (const outcome of outcomes) {
      expect(outcome).toEqual({ type: 'cancelled', message: 'shutdown' });
    }
  });

  it('returns empty array when cancelAll with no pending sessions', () => {
    expect(dispatcher.cancelAll('nothing')).toEqual([]);
  });

  // ── directories() dedupe ─────────────────────────────────────────────

  it('returns unique directories only', () => {
    dispatcher.register('s1', { directory: '/tmp/a', timeoutMs: 5_000 });
    dispatcher.register('s2', { directory: '/tmp/b', timeoutMs: 5_000 });
    dispatcher.register('s3', { directory: '/tmp/a', timeoutMs: 5_000 });

    const dirs = dispatcher.directories();
    expect(dirs).toHaveLength(2);
    expect(dirs).toContain('/tmp/a');
    expect(dirs).toContain('/tmp/b');
  });

  it('returns empty array when no sessions are registered', () => {
    expect(dispatcher.directories()).toEqual([]);
  });

  it('excludes directories of resolved sessions', () => {
    dispatcher.register('s1', { directory: '/tmp/a', timeoutMs: 5_000 });
    dispatcher.register('s2', { directory: '/tmp/b', timeoutMs: 5_000 });

    dispatcher.resolve('s1', { type: 'idle' });

    const dirs = dispatcher.directories();
    expect(dirs).toEqual(['/tmp/b']);
  });

  // ── Unknown session ──────────────────────────────────────────────────

  it('returns false when resolving an unknown session', () => {
    expect(dispatcher.resolve('ghost', { type: 'idle' })).toBe(false);
  });

  it('returns false when resolving an already-resolved session', () => {
    dispatcher.register('s1', { directory: '/tmp/a', timeoutMs: 5_000 });
    dispatcher.resolve('s1', { type: 'idle' });

    // Second resolve should return false — session already removed.
    expect(dispatcher.resolve('s1', { type: 'idle' })).toBe(false);
  });

  // ── Concurrent sessions ──────────────────────────────────────────────

  it('independently resolves multiple concurrent sessions', async () => {
    const p1 = dispatcher.register('s1', {
      directory: '/tmp/a',
      timeoutMs: 5_000,
    });
    const p2 = dispatcher.register('s2', {
      directory: '/tmp/b',
      timeoutMs: 5_000,
    });

    dispatcher.resolve('s2', { type: 'error', message: 'fail' });
    dispatcher.resolve('s1', { type: 'idle' });

    expect(await p1).toEqual({ type: 'idle' });
    expect(await p2).toEqual({ type: 'error', message: 'fail' });
  });
});
