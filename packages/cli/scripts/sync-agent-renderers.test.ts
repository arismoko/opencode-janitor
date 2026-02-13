import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  CSS_MANIFEST_FILENAME,
  detectCollisions,
  discoverRendererSources,
  findStaleTargetFiles,
  generateCssManifest,
  isValidRendererFilename,
  type RendererSourceEntry,
  syncAgentRenderers,
} from './sync-agent-renderers';

function createTempDir(): string {
  const dir = resolve(
    tmpdir(),
    `sync-renderer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('sync-agent-renderers', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = createTempDir();
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('isValidRendererFilename', () => {
    it('accepts valid JS renderer filenames', () => {
      expect(isValidRendererFilename('architecture-v1.js')).toBe(true);
      expect(isValidRendererFilename('smoke-v0.js')).toBe(true);
      expect(isValidRendererFilename('deep-analysis-v12.js')).toBe(true);
      expect(isValidRendererFilename('a-v1.js')).toBe(true);
    });

    it('accepts valid CSS renderer filenames', () => {
      expect(isValidRendererFilename('architecture-v1.css')).toBe(true);
      expect(isValidRendererFilename('bug-analysis-v2.css')).toBe(true);
      expect(isValidRendererFilename('deep-analysis-v12.css')).toBe(true);
    });

    it('rejects invalid renderer filenames', () => {
      expect(isValidRendererFilename('Architecture-v1.js')).toBe(false);
      expect(isValidRendererFilename('no-version.js')).toBe(false);
      expect(isValidRendererFilename('bad_underscore-v1.js')).toBe(false);
      expect(isValidRendererFilename('v1.js')).toBe(false);
      expect(isValidRendererFilename('.hidden-v1.js')).toBe(false);
      expect(isValidRendererFilename('renderer-v1.ts')).toBe(false);
      expect(isValidRendererFilename('renderer-v1.mjs')).toBe(false);
      expect(isValidRendererFilename('')).toBe(false);
      expect(isValidRendererFilename('-v1.js')).toBe(false);
      expect(isValidRendererFilename('renderer-v1.scss')).toBe(false);
    });
  });

  describe('discoverRendererSources', () => {
    it('discovers JS renderer files from agent directories', () => {
      const sourceBase = resolve(tempRoot, 'source-agents');
      const targetBase = resolve(tempRoot, 'target-agents');

      const agentDir = resolve(sourceBase, 'agent-alpha/renderers');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        resolve(agentDir, 'widget-v1.js'),
        'export function renderFindingEnrichment() {}',
      );

      const { entries, errors } = discoverRendererSources(
        sourceBase,
        targetBase,
      );

      expect(errors).toEqual([]);
      expect(entries).toHaveLength(1);
      expect(entries[0].agent).toBe('agent-alpha');
      expect(entries[0].filename).toBe('widget-v1.js');
      expect(entries[0].targetPath).toBe(
        resolve(targetBase, 'agent-alpha/widget-v1.js'),
      );
    });

    it('discovers CSS renderer files from agent directories', () => {
      const sourceBase = resolve(tempRoot, 'source-agents');
      const targetBase = resolve(tempRoot, 'target-agents');

      const agentDir = resolve(sourceBase, 'agent-alpha/renderers');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(resolve(agentDir, 'widget-v1.css'), '.widget {}');

      const { entries, errors } = discoverRendererSources(
        sourceBase,
        targetBase,
      );

      expect(errors).toEqual([]);
      expect(entries).toHaveLength(1);
      expect(entries[0].filename).toBe('widget-v1.css');
    });

    it('discovers both JS and CSS files together', () => {
      const sourceBase = resolve(tempRoot, 'source-agents');
      const targetBase = resolve(tempRoot, 'target-agents');

      const agentDir = resolve(sourceBase, 'agent-alpha/renderers');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(resolve(agentDir, 'widget-v1.js'), '// js');
      writeFileSync(resolve(agentDir, 'widget-v1.css'), '/* css */');

      const { entries, errors } = discoverRendererSources(
        sourceBase,
        targetBase,
      );

      expect(errors).toEqual([]);
      expect(entries).toHaveLength(2);
      expect(entries.map((e) => e.filename)).toEqual([
        'widget-v1.css',
        'widget-v1.js',
      ]);
    });

    it('skips core directory', () => {
      const sourceBase = resolve(tempRoot, 'source-agents');
      const targetBase = resolve(tempRoot, 'target-agents');

      const coreDir = resolve(sourceBase, 'core/renderers');
      mkdirSync(coreDir, { recursive: true });
      writeFileSync(resolve(coreDir, 'base-v1.js'), '// core renderer');

      const { entries, errors } = discoverRendererSources(
        sourceBase,
        targetBase,
      );

      expect(errors).toEqual([]);
      expect(entries).toHaveLength(0);
    });

    it('reports errors for invalid filenames', () => {
      const sourceBase = resolve(tempRoot, 'source-agents');
      const targetBase = resolve(tempRoot, 'target-agents');

      const agentDir = resolve(sourceBase, 'agent-beta/renderers');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(resolve(agentDir, 'BadName.js'), '// invalid');
      writeFileSync(resolve(agentDir, 'good-v1.js'), '// valid');

      const { entries, errors } = discoverRendererSources(
        sourceBase,
        targetBase,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('BadName.js');
      expect(entries).toHaveLength(1);
      expect(entries[0].filename).toBe('good-v1.js');
    });

    it('reports errors for invalid CSS filenames', () => {
      const sourceBase = resolve(tempRoot, 'source-agents');
      const targetBase = resolve(tempRoot, 'target-agents');

      const agentDir = resolve(sourceBase, 'agent-beta/renderers');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(resolve(agentDir, 'BadName.css'), '/* invalid */');
      writeFileSync(resolve(agentDir, 'good-v1.css'), '/* valid */');

      const { entries, errors } = discoverRendererSources(
        sourceBase,
        targetBase,
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('BadName.css');
      expect(entries).toHaveLength(1);
      expect(entries[0].filename).toBe('good-v1.css');
    });

    it('returns empty for missing source directory', () => {
      const { entries, errors } = discoverRendererSources(
        resolve(tempRoot, 'nonexistent'),
        resolve(tempRoot, 'target'),
      );

      expect(errors).toEqual([]);
      expect(entries).toEqual([]);
    });

    it('sorts entries deterministically', () => {
      const sourceBase = resolve(tempRoot, 'source-agents');
      const targetBase = resolve(tempRoot, 'target-agents');

      for (const agent of ['zulu', 'alpha']) {
        const dir = resolve(sourceBase, `${agent}/renderers`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, 'beta-v1.js'), '// r');
        writeFileSync(resolve(dir, 'alpha-v1.js'), '// r');
      }

      const { entries } = discoverRendererSources(sourceBase, targetBase);

      expect(entries.map((e) => `${e.agent}/${e.filename}`)).toEqual([
        'alpha/alpha-v1.js',
        'alpha/beta-v1.js',
        'zulu/alpha-v1.js',
        'zulu/beta-v1.js',
      ]);
    });
  });

  describe('detectCollisions', () => {
    it('returns empty for unique targets', () => {
      const entries: RendererSourceEntry[] = [
        {
          agent: 'a',
          filename: 'x-v1.js',
          sourcePath: '/s/a/x-v1.js',
          targetPath: '/t/a/x-v1.js',
        },
        {
          agent: 'b',
          filename: 'y-v1.js',
          sourcePath: '/s/b/y-v1.js',
          targetPath: '/t/b/y-v1.js',
        },
      ];

      expect(detectCollisions(entries)).toEqual([]);
    });

    it('detects duplicate target paths', () => {
      const entries: RendererSourceEntry[] = [
        {
          agent: 'a',
          filename: 'x-v1.js',
          sourcePath: '/s/a/x-v1.js',
          targetPath: '/t/shared/x-v1.js',
        },
        {
          agent: 'b',
          filename: 'x-v1.js',
          sourcePath: '/s/b/x-v1.js',
          targetPath: '/t/shared/x-v1.js',
        },
      ];

      const errors = detectCollisions(entries);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Collision');
    });
  });

  describe('findStaleTargetFiles', () => {
    it('identifies stale JS files in target not present in source entries', () => {
      const targetBase = resolve(tempRoot, 'target-agents');
      const agentDir = resolve(targetBase, 'agent-alpha');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(resolve(agentDir, 'old-v1.js'), '// stale');
      writeFileSync(resolve(agentDir, 'current-v1.js'), '// current');

      const entries: RendererSourceEntry[] = [
        {
          agent: 'agent-alpha',
          filename: 'current-v1.js',
          sourcePath: '/s/agent-alpha/renderers/current-v1.js',
          targetPath: resolve(agentDir, 'current-v1.js'),
        },
      ];

      const stale = findStaleTargetFiles(entries, targetBase);
      expect(stale).toEqual([resolve(agentDir, 'old-v1.js')]);
    });

    it('identifies stale CSS files in target not present in source entries', () => {
      const targetBase = resolve(tempRoot, 'target-agents');
      const agentDir = resolve(targetBase, 'agent-alpha');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(resolve(agentDir, 'old-v1.css'), '/* stale */');
      writeFileSync(resolve(agentDir, 'current-v1.css'), '/* current */');

      const entries: RendererSourceEntry[] = [
        {
          agent: 'agent-alpha',
          filename: 'current-v1.css',
          sourcePath: '/s/agent-alpha/renderers/current-v1.css',
          targetPath: resolve(agentDir, 'current-v1.css'),
        },
      ];

      const stale = findStaleTargetFiles(entries, targetBase);
      expect(stale).toEqual([resolve(agentDir, 'old-v1.css')]);
    });

    it('identifies stale agent directories with no source entries', () => {
      const targetBase = resolve(tempRoot, 'target-agents');
      const staleDir = resolve(targetBase, 'removed-agent');
      mkdirSync(staleDir, { recursive: true });
      writeFileSync(resolve(staleDir, 'old-v1.js'), '// stale');

      const stale = findStaleTargetFiles([], targetBase);
      expect(stale).toEqual([resolve(staleDir, 'old-v1.js')]);
    });

    it('returns empty when target directory does not exist', () => {
      const stale = findStaleTargetFiles([], resolve(tempRoot, 'nonexistent'));
      expect(stale).toEqual([]);
    });
  });

  describe('generateCssManifest', () => {
    it('returns empty string when no CSS entries exist', () => {
      const entries: RendererSourceEntry[] = [
        {
          agent: 'a',
          filename: 'x-v1.js',
          sourcePath: '/s/a/x-v1.js',
          targetPath: '/t/a/x-v1.js',
        },
      ];

      expect(generateCssManifest(entries)).toBe('');
    });

    it('generates deterministic sorted @import lines for CSS entries', () => {
      const entries: RendererSourceEntry[] = [
        {
          agent: 'zulu',
          filename: 'widget-v1.css',
          sourcePath: '/s/zulu/renderers/widget-v1.css',
          targetPath: '/t/zulu/widget-v1.css',
        },
        {
          agent: 'alpha',
          filename: 'chart-v1.css',
          sourcePath: '/s/alpha/renderers/chart-v1.css',
          targetPath: '/t/alpha/chart-v1.css',
        },
        {
          agent: 'alpha',
          filename: 'chart-v1.js',
          sourcePath: '/s/alpha/renderers/chart-v1.js',
          targetPath: '/t/alpha/chart-v1.js',
        },
      ];

      // Entries are pre-sorted by agent/filename, so manifest preserves order
      const manifest = generateCssManifest(entries);
      expect(manifest).toContain(
        '/* Auto-generated by sync-agent-renderers. Do not edit. */',
      );
      expect(manifest).toContain('@import "./zulu/widget-v1.css";');
      expect(manifest).toContain('@import "./alpha/chart-v1.css";');
      // JS entries are excluded
      expect(manifest).not.toContain('chart-v1.js');
    });
  });

  describe('syncAgentRenderers (integration)', () => {
    it('copies valid JS renderer to target with sync header', () => {
      const agentSource = resolve(
        tempRoot,
        'packages/shared/src/agents/agent-alpha/renderers',
      );
      mkdirSync(agentSource, { recursive: true });
      writeFileSync(
        resolve(agentSource, 'widget-v1.js'),
        'export function renderFindingEnrichment() {}\n',
      );

      const result = syncAgentRenderers(tempRoot);

      expect(result.errors).toEqual([]);
      expect(result.copied).toHaveLength(1);

      const targetPath = resolve(
        tempRoot,
        'packages/cli/src/daemon/frontend/views/reports/finding-enrichments/renderers/agents/agent-alpha/widget-v1.js',
      );
      expect(existsSync(targetPath)).toBe(true);
      const content = readFileSync(targetPath, 'utf-8');
      expect(content).toStartWith(
        '// Synced from agent source by sync-agent-renderers. Do not edit.\n',
      );
      expect(content).toContain('export function renderFindingEnrichment()');
    });

    it('copies valid CSS renderer to target with CSS sync header', () => {
      const agentSource = resolve(
        tempRoot,
        'packages/shared/src/agents/agent-alpha/renderers',
      );
      mkdirSync(agentSource, { recursive: true });
      writeFileSync(
        resolve(agentSource, 'widget-v1.css'),
        '.widget { color: red; }\n',
      );

      const result = syncAgentRenderers(tempRoot);

      expect(result.errors).toEqual([]);
      // CSS file + manifest = 2 copied
      expect(result.copied).toHaveLength(2);

      const targetPath = resolve(
        tempRoot,
        'packages/cli/src/daemon/frontend/views/reports/finding-enrichments/renderers/agents/agent-alpha/widget-v1.css',
      );
      expect(existsSync(targetPath)).toBe(true);
      const content = readFileSync(targetPath, 'utf-8');
      expect(content).toStartWith(
        '/* Synced from agent source by sync-agent-renderers. Do not edit. */\n',
      );
      expect(content).toContain('.widget { color: red; }');
    });

    it('generates CSS manifest when CSS renderers are present', () => {
      const agentSource = resolve(
        tempRoot,
        'packages/shared/src/agents/agent-alpha/renderers',
      );
      mkdirSync(agentSource, { recursive: true });
      writeFileSync(resolve(agentSource, 'widget-v1.css'), '.widget {}');
      writeFileSync(resolve(agentSource, 'widget-v1.js'), '// js');

      const result = syncAgentRenderers(tempRoot);
      expect(result.errors).toEqual([]);

      const manifestPath = resolve(
        tempRoot,
        `packages/cli/src/daemon/frontend/views/reports/finding-enrichments/renderers/agents/${CSS_MANIFEST_FILENAME}`,
      );
      expect(existsSync(manifestPath)).toBe(true);

      const manifest = readFileSync(manifestPath, 'utf-8');
      expect(manifest).toContain(
        '/* Auto-generated by sync-agent-renderers. Do not edit. */',
      );
      expect(manifest).toContain('@import "./agent-alpha/widget-v1.css";');
    });

    it('does not generate CSS manifest when no CSS renderers exist', () => {
      const agentSource = resolve(
        tempRoot,
        'packages/shared/src/agents/agent-alpha/renderers',
      );
      mkdirSync(agentSource, { recursive: true });
      writeFileSync(resolve(agentSource, 'widget-v1.js'), '// js only');

      const result = syncAgentRenderers(tempRoot);
      expect(result.errors).toEqual([]);

      const manifestPath = resolve(
        tempRoot,
        `packages/cli/src/daemon/frontend/views/reports/finding-enrichments/renderers/agents/${CSS_MANIFEST_FILENAME}`,
      );
      expect(existsSync(manifestPath)).toBe(false);
    });

    it('removes stale CSS manifest when CSS renderers are removed', () => {
      const targetBase = resolve(
        tempRoot,
        'packages/cli/src/daemon/frontend/views/reports/finding-enrichments/renderers/agents',
      );
      mkdirSync(targetBase, { recursive: true });
      const manifestPath = resolve(targetBase, CSS_MANIFEST_FILENAME);
      writeFileSync(manifestPath, '/* stale manifest */');

      // No source files
      const agentDir = resolve(tempRoot, 'packages/shared/src/agents');
      mkdirSync(agentDir, { recursive: true });

      const result = syncAgentRenderers(tempRoot);
      expect(result.errors).toEqual([]);
      expect(result.removed).toContain(manifestPath);
      expect(existsSync(manifestPath)).toBe(false);
    });

    it('removes stale target files', () => {
      const staleTarget = resolve(
        tempRoot,
        'packages/cli/src/daemon/frontend/views/reports/finding-enrichments/renderers/agents/agent-alpha',
      );
      mkdirSync(staleTarget, { recursive: true });
      writeFileSync(resolve(staleTarget, 'old-v1.js'), '// stale');

      // No source files
      const agentDir = resolve(tempRoot, 'packages/shared/src/agents');
      mkdirSync(agentDir, { recursive: true });

      const result = syncAgentRenderers(tempRoot);

      expect(result.errors).toEqual([]);
      expect(result.removed).toHaveLength(1);
      expect(existsSync(resolve(staleTarget, 'old-v1.js'))).toBe(false);
    });

    it('removes stale CSS target files', () => {
      const staleTarget = resolve(
        tempRoot,
        'packages/cli/src/daemon/frontend/views/reports/finding-enrichments/renderers/agents/agent-alpha',
      );
      mkdirSync(staleTarget, { recursive: true });
      writeFileSync(resolve(staleTarget, 'old-v1.css'), '/* stale */');

      const agentDir = resolve(tempRoot, 'packages/shared/src/agents');
      mkdirSync(agentDir, { recursive: true });

      const result = syncAgentRenderers(tempRoot);

      expect(result.errors).toEqual([]);
      expect(result.removed.some((p) => p.endsWith('old-v1.css'))).toBe(true);
      expect(existsSync(resolve(staleTarget, 'old-v1.css'))).toBe(false);
    });

    it('fails on invalid filenames', () => {
      const agentSource = resolve(
        tempRoot,
        'packages/shared/src/agents/agent-alpha/renderers',
      );
      mkdirSync(agentSource, { recursive: true });
      writeFileSync(resolve(agentSource, 'BAD_NAME.js'), '// invalid');

      const result = syncAgentRenderers(tempRoot);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('BAD_NAME.js');
      expect(result.copied).toEqual([]);
    });

    it('is idempotent on repeated sync', () => {
      const agentSource = resolve(
        tempRoot,
        'packages/shared/src/agents/agent-alpha/renderers',
      );
      mkdirSync(agentSource, { recursive: true });
      writeFileSync(
        resolve(agentSource, 'widget-v1.js'),
        'export function renderFindingEnrichment() {}\n',
      );
      writeFileSync(
        resolve(agentSource, 'widget-v1.css'),
        '.widget { color: red; }\n',
      );

      const first = syncAgentRenderers(tempRoot);
      expect(first.copied.length).toBeGreaterThan(0);

      const second = syncAgentRenderers(tempRoot);
      expect(second.copied).toEqual([]);
      expect(second.removed).toEqual([]);
      expect(second.errors).toEqual([]);
    });

    it('is idempotent for CSS manifest on repeated sync', () => {
      const agentSource = resolve(
        tempRoot,
        'packages/shared/src/agents/agent-alpha/renderers',
      );
      mkdirSync(agentSource, { recursive: true });
      writeFileSync(resolve(agentSource, 'widget-v1.css'), '.widget {}');

      const first = syncAgentRenderers(tempRoot);
      expect(first.copied.some((p) => p.endsWith(CSS_MANIFEST_FILENAME))).toBe(
        true,
      );

      const second = syncAgentRenderers(tempRoot);
      expect(second.copied.some((p) => p.endsWith(CSS_MANIFEST_FILENAME))).toBe(
        false,
      );
    });
  });
});
