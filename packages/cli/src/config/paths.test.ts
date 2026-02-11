import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  defaultLockPath,
  defaultPidPath,
  defaultSocketPath,
  runtimeDir,
  stateDir,
} from './paths';

describe('runtimeDir', () => {
  let originalXdg: string | undefined;

  beforeEach(() => {
    originalXdg = process.env['XDG_RUNTIME_DIR'];
  });

  afterEach(() => {
    if (originalXdg !== undefined) {
      process.env['XDG_RUNTIME_DIR'] = originalXdg;
    } else {
      delete process.env['XDG_RUNTIME_DIR'];
    }
  });

  it('uses XDG_RUNTIME_DIR when set', () => {
    process.env['XDG_RUNTIME_DIR'] = '/run/user/1000';
    expect(runtimeDir()).toBe('/run/user/1000/opencode-janitor');
  });

  it('falls back to stateDir when XDG_RUNTIME_DIR is unset', () => {
    delete process.env['XDG_RUNTIME_DIR'];
    expect(runtimeDir()).toBe(stateDir());
  });
});

describe('daemon path defaults', () => {
  it('defaultSocketPath ends with janitor.sock', () => {
    expect(defaultSocketPath()).toMatch(/janitor\.sock$/);
  });

  it('defaultPidPath ends with janitor.pid', () => {
    expect(defaultPidPath()).toMatch(/janitor\.pid$/);
  });

  it('defaultLockPath ends with janitor.lock', () => {
    expect(defaultLockPath()).toMatch(/janitor\.lock$/);
  });

  it('all share the same parent directory', () => {
    const sockDir = defaultSocketPath().replace(/\/[^/]+$/, '');
    const pidDir = defaultPidPath().replace(/\/[^/]+$/, '');
    const lockDir = defaultLockPath().replace(/\/[^/]+$/, '');
    expect(sockDir).toBe(pidDir);
    expect(pidDir).toBe(lockDir);
    expect(sockDir).toBe(runtimeDir());
  });
});
