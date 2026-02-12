import { describe, expect, it } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../../../../..');

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.turbo',
]);

const ALLOWED_EXACT_FILES = new Set([
  'packages/shared/src/agents/core/agent-boundary.test.ts',
  'packages/shared/src/agents/core/manifest.generated.ts',
]);

const BUILTIN_AGENT_IDS = new Set(['janitor', 'hunter', 'inspector', 'scribe']);

function isAllowedPath(repoRelativePath: string): boolean {
  if (ALLOWED_EXACT_FILES.has(repoRelativePath)) {
    return true;
  }

  const sharedAgentMatch = /^packages\/shared\/src\/agents\/([^/]+)\//u.exec(
    repoRelativePath,
  );
  if (sharedAgentMatch && sharedAgentMatch[1] !== 'core') {
    return true;
  }

  if (
    /^packages\/cli\/src\/daemon\/frontend\/views\/reports\/finding-enrichments\/renderers\/agents\/[^/]+\//u.test(
      repoRelativePath,
    )
  ) {
    return true;
  }

  return false;
}

function isStandaloneAgentToken(token: string): boolean {
  return BUILTIN_AGENT_IDS.has(token);
}

function tokenize(content: string): string[] {
  return content.match(/[A-Za-z0-9@._/-]+/gu) ?? [];
}

async function walk(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }

    const nextPath = resolve(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(nextPath)));
      continue;
    }

    if (!SCAN_EXTENSIONS.has(extname(entry.name))) {
      continue;
    }

    files.push(nextPath);
  }

  return files;
}

describe('agent boundary enforcement', () => {
  it('blocks standalone built-in agent id tokens outside approved directories', async () => {
    const files = await walk(REPO_ROOT);
    const violations: string[] = [];

    for (const filePath of files) {
      const repoRelativePath = relative(REPO_ROOT, filePath).replaceAll(
        '\\',
        '/',
      );
      if (isAllowedPath(repoRelativePath)) {
        continue;
      }

      const content = await readFile(filePath, 'utf8');
      const tokens = tokenize(content);
      const hasViolation = tokens.some((token) =>
        isStandaloneAgentToken(token),
      );
      if (hasViolation) {
        violations.push(repoRelativePath);
      }
    }

    expect(violations, violations.join('\n')).toEqual([]);
  });
});
