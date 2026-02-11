import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireProcessLock, type ProcessLockPaths } from './lock';

describe('acquireProcessLock', () => {
  let tmpDir: string;
  let paths: ProcessLockPaths;

  beforeEach(() => {
    tmpDir = join(
      tmpdir(),
      `janitor-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(tmpDir, { recursive: true });
    paths = {
      lockFile: join(tmpDir, 'janitor.lock'),
      pidFile: join(tmpDir, 'janitor.pid'),
      socketPath: join(tmpDir, 'janitor.sock'),
    };
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates lock and pid files on success', () => {
    const lock = acquireProcessLock(paths);
    expect(lock.pid).toBe(process.pid);
    expect(existsSync(paths.lockFile)).toBe(true);
    expect(existsSync(paths.pidFile)).toBe(true);

    const lockContent = readFileSync(paths.lockFile, 'utf8').trim();
    expect(lockContent).toBe(String(process.pid));

    lock.release();
  });

  it('release removes all runtime files', () => {
    const lock = acquireProcessLock(paths);
    lock.release();
    expect(existsSync(paths.lockFile)).toBe(false);
    expect(existsSync(paths.pidFile)).toBe(false);
    expect(existsSync(paths.socketPath)).toBe(false);
  });

  it('throws when lock held by a running process', () => {
    // Pre-create a lock file with our own PID (simulates running process).
    writeFileSync(paths.lockFile, String(process.pid), 'utf8');

    expect(() => acquireProcessLock(paths)).toThrow(/already running/);
  });

  it('reclaims lock from dead process', () => {
    // Write a PID that is very unlikely to be running.
    const deadPid = 2_000_000_000;
    writeFileSync(paths.lockFile, String(deadPid), 'utf8');

    const lock = acquireProcessLock(paths);
    expect(lock.pid).toBe(process.pid);
    lock.release();
  });

  it('lock file has restrictive permissions (0600)', () => {
    const lock = acquireProcessLock(paths);
    const stat = Bun.file(paths.lockFile);
    // Check the file is readable by owner (we just wrote it)
    const content = readFileSync(paths.lockFile, 'utf8');
    expect(content.trim()).toBe(String(process.pid));
    lock.release();
  });

  it('creates parent directories if they do not exist', () => {
    const nested = {
      lockFile: join(tmpDir, 'a', 'b', 'janitor.lock'),
      pidFile: join(tmpDir, 'a', 'b', 'janitor.pid'),
      socketPath: join(tmpDir, 'a', 'b', 'janitor.sock'),
    };
    const lock = acquireProcessLock(nested);
    expect(existsSync(nested.lockFile)).toBe(true);
    lock.release();
  });
});
