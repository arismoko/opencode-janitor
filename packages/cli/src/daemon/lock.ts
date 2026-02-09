import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { ensureParentDirs } from '../config/paths';

export interface ProcessLockPaths {
  lockFile: string;
  pidFile: string;
  socketPath: string;
}

export interface ProcessLock {
  pid: number;
  release: () => void;
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(filePath: string): number | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function removeIfExists(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch {
    // Ignore cleanup errors.
  }
}

export function acquireProcessLock(paths: ProcessLockPaths): ProcessLock {
  const existingPid = readPid(paths.pidFile) ?? readPid(paths.lockFile);
  if (existingPid && isProcessRunning(existingPid)) {
    throw new Error(
      `Daemon already running (pid=${existingPid}). Stop it before starting a new instance.`,
    );
  }

  removeIfExists(paths.socketPath);
  removeIfExists(paths.pidFile);
  removeIfExists(paths.lockFile);

  ensureParentDirs(paths.lockFile);
  ensureParentDirs(paths.pidFile);
  ensureParentDirs(paths.socketPath);

  const pid = process.pid;
  writeFileSync(paths.lockFile, String(pid), 'utf8');
  writeFileSync(paths.pidFile, String(pid), 'utf8');

  return {
    pid,
    release: () => {
      removeIfExists(paths.socketPath);
      removeIfExists(paths.pidFile);
      removeIfExists(paths.lockFile);
    },
  };
}
