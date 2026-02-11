import {
  chmodSync,
  closeSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
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

function readPidFromFile(filePath: string): number | null {
  try {
    const raw = readFileSync(filePath, 'utf8').trim();
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function removeIfExists(filePath: string): void {
  try {
    rmSync(filePath, { force: true });
  } catch {
    // Ignore cleanup errors.
  }
}

/**
 * Try to exclusively create the lock file (O_CREAT | O_EXCL | O_WRONLY).
 * Returns the fd on success, or null if the file already exists.
 */
function tryExclusiveCreate(filePath: string): number | null {
  try {
    // 'wx' = O_WRONLY | O_CREAT | O_EXCL — atomic create-or-fail
    return openSync(filePath, 'wx', 0o600);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'EEXIST') {
      return null;
    }
    throw err;
  }
}

/**
 * Acquire a process lock atomically using exclusive file creation.
 *
 * Uses O_CREAT | O_EXCL to prevent TOCTOU races between concurrent
 * `start` invocations. If a stale lock from a dead process is found,
 * it is cleaned up and the lock is retried once.
 */
export function acquireProcessLock(paths: ProcessLockPaths): ProcessLock {
  ensureParentDirs(paths.lockFile);
  ensureParentDirs(paths.pidFile);
  ensureParentDirs(paths.socketPath);

  const pid = process.pid;
  const pidContent = Buffer.from(String(pid));

  let fd = tryExclusiveCreate(paths.lockFile);

  if (fd === null) {
    // Lock file exists — check if the holder is still alive.
    const existingPid = readPidFromFile(paths.lockFile);
    if (existingPid && isProcessRunning(existingPid)) {
      throw new Error(
        `Daemon already running (pid=${existingPid}). Stop it before starting a new instance.`,
      );
    }

    // Stale lock from a dead process — clean up and retry once.
    try {
      unlinkSync(paths.lockFile);
    } catch {
      // Another racer may have already cleaned it up.
    }

    fd = tryExclusiveCreate(paths.lockFile);
    if (fd === null) {
      // Another process won the race — they hold the lock now.
      const racerPid = readPidFromFile(paths.lockFile);
      throw new Error(
        `Daemon already running (pid=${racerPid ?? 'unknown'}). Stop it before starting a new instance.`,
      );
    }
  }

  // Write PID into the lock file we now exclusively own.
  writeSync(fd, pidContent);
  closeSync(fd);
  chmodSync(paths.lockFile, 0o600);

  // Clean up stale runtime files.
  removeIfExists(paths.socketPath);
  removeIfExists(paths.pidFile);

  // Write a separate PID file for compatibility.
  try {
    const pidFd = openSync(paths.pidFile, 'w', 0o600);
    writeSync(pidFd, pidContent);
    closeSync(pidFd);
    chmodSync(paths.pidFile, 0o600);
  } catch {
    // PID file is informational — lock file is the authority.
  }

  return {
    pid,
    release: () => {
      removeIfExists(paths.socketPath);
      removeIfExists(paths.pidFile);
      removeIfExists(paths.lockFile);
    },
  };
}
