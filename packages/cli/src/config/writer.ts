/**
 * Atomic config writer and TOML renderer.
 */
import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultConfigPath, ensureParentDirs } from './paths';
import { type CliConfig, defaultCliConfig } from './schema';

// ---------------------------------------------------------------------------
// TOML renderer (manual, keeps it readable)
// ---------------------------------------------------------------------------

function tomlBool(v: boolean): string {
  return v ? 'true' : 'false';
}

function tomlStringArray(values: string[]): string {
  return `[${values.map((v) => `"${v}"`).join(', ')}]`;
}

function renderToml(c: CliConfig): string {
  const lines: string[] = [
    '# opencode-janitor CLI config',
    '# https://github.com/opencode-janitor',
    '',
    '[daemon]',
    `socketPath = "${c.daemon.socketPath}"`,
    `pidFile = "${c.daemon.pidFile}"`,
    `lockFile = "${c.daemon.lockFile}"`,
    `logLevel = "${c.daemon.logLevel}"`,
    '',
    '[scheduler]',
    `globalConcurrency = ${c.scheduler.globalConcurrency}`,
    `perRepoConcurrency = ${c.scheduler.perRepoConcurrency}`,
    `agentParallelism = ${c.scheduler.agentParallelism}`,
    `maxAttempts = ${c.scheduler.maxAttempts}`,
    `retryBackoffMs = ${c.scheduler.retryBackoffMs}`,
    '',
    '[git]',
    `commitDebounceMs = ${c.git.commitDebounceMs}`,
    `commitPollSec = ${c.git.commitPollSec}`,
    `prPollSec = ${c.git.prPollSec}`,
    `prBaseBranch = "${c.git.prBaseBranch}"`,
    `enableFsWatch = ${tomlBool(c.git.enableFsWatch)}`,
    `enableGhPr = ${tomlBool(c.git.enableGhPr)}`,
    '',
    '[detector]',
    `minPollSec = ${c.detector.minPollSec}`,
    `maxPollSec = ${c.detector.maxPollSec}`,
    `probeConcurrency = ${c.detector.probeConcurrency}`,
    `prTtlSec = ${c.detector.prTtlSec}`,
    `pollJitterPct = ${c.detector.pollJitterPct}`,
    '',
    '[scope]',
    `include = ${tomlStringArray(c.scope.include)}`,
    `exclude = ${tomlStringArray(c.scope.exclude)}`,
    '',
    '[opencode]',
    `defaultModelId = "${c.opencode.defaultModelId}"`,
    `hubSessionTitle = "${c.opencode.hubSessionTitle}"`,
    `serverHost = "${c.opencode.serverHost}"`,
    `serverPort = ${c.opencode.serverPort}`,
    `serverStartTimeoutMs = ${c.opencode.serverStartTimeoutMs}`,
    '',
  ];

  for (const agent of ['janitor', 'hunter', 'inspector', 'scribe'] as const) {
    const a = c.agents[agent];
    lines.push(`[agents.${agent}]`);
    lines.push(`enabled = ${tomlBool(a.enabled)}`);
    lines.push(`trigger = "${a.trigger}"`);
    lines.push(`maxFindings = ${a.maxFindings}`);
    if (a.modelId !== undefined) {
      lines.push(`modelId = "${a.modelId}"`);
    }
    if (a.variant !== undefined) {
      lines.push(`variant = "${a.variant}"`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Atomic write helper
// ---------------------------------------------------------------------------

function atomicWrite(filePath: string, content: string): void {
  ensureParentDirs(filePath);
  const tmpPath = join(dirname(filePath), `.tmp-${Date.now()}`);
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Write config object to TOML file atomically. */
export function writeConfig(config: CliConfig, filePath?: string): void {
  const path = filePath ?? defaultConfigPath();
  atomicWrite(path, renderToml(config));
}

/**
 * Ensure the config file exists, creating it with defaults if missing.
 * Returns the path to the config file.
 */
export function ensureConfigFile(filePath?: string): string {
  const path = filePath ?? defaultConfigPath();
  if (!existsSync(path)) {
    writeConfig(defaultCliConfig, path);
  }
  return path;
}
