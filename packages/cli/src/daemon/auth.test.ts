import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateAuthToken, readAuthToken, writeAuthToken } from './auth';

describe('auth token', () => {
  describe('generateAuthToken', () => {
    it('returns a 64-character hex string', () => {
      const token = generateAuthToken();
      expect(token).toHaveLength(64);
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it('generates unique tokens', () => {
      const a = generateAuthToken();
      const b = generateAuthToken();
      expect(a).not.toBe(b);
    });
  });

  describe('writeAuthToken / readAuthToken', () => {
    let tmpDir: string;
    let originalEnv: string | undefined;

    beforeEach(() => {
      tmpDir = join(
        tmpdir(),
        `janitor-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
      mkdirSync(tmpDir, { recursive: true });
      originalEnv = process.env['XDG_RUNTIME_DIR'];
      process.env['XDG_RUNTIME_DIR'] = tmpDir;
    });

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env['XDG_RUNTIME_DIR'] = originalEnv;
      } else {
        delete process.env['XDG_RUNTIME_DIR'];
      }
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('round-trips a token through write and read', () => {
      const token = generateAuthToken();
      writeAuthToken(token);
      expect(readAuthToken()).toBe(token);
    });

    it('returns null when token file does not exist', () => {
      // Point to empty tmpDir — no token file exists
      expect(readAuthToken()).toBe(null);
    });
  });
});
