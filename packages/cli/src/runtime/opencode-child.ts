/**
 * Daemon-owned opencode server child process.
 *
 * Spawns `opencode serve` as a direct child of the CLI daemon process,
 * ensuring the server is always cleaned up when the daemon exits.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import {
  createOpencodeClient,
  type OpencodeClient,
  type Config as OpencodeConfig,
} from '@opencode-ai/sdk';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpencodeChildOptions {
  /** Host for the opencode server. */
  host: string;
  /** Port for the opencode server. */
  port: number;
  /** Timeout (ms) waiting for the server to print its listening line. */
  startTimeoutMs: number;
  /** Opencode SDK config to inject via OPENCODE_CONFIG_CONTENT env var. */
  config?: OpencodeConfig;
  /** Opencode log level (DEBUG | INFO | WARN | ERROR). */
  logLevel?: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
}

export interface OpencodeChild {
  /** Pre-configured SDK client pointing at the child server. */
  client: OpencodeClient;
  /** URL the server is listening on. */
  url: string;
  /** OS pid of the child process. */
  pid: number;
  /** Gracefully terminate the child (idempotent). */
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const LISTENING_RE = /opencode server listening on (https?:\/\/\S+)/i;
const FATAL_STARTUP_RE =
  /(EADDRINUSE|address already in use|EACCES|permission denied)/i;
const SIGKILL_GRACE_MS = 5_000;

export async function startOpencodeChild(
  options: OpencodeChildOptions,
): Promise<OpencodeChild> {
  const { host, port, startTimeoutMs, config: sdkConfig, logLevel } = options;

  const args = ['serve', `--hostname=${host}`, `--port=${port}`];

  if (logLevel) {
    args.push(`--log-level=${logLevel}`);
  }

  const env: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;
  if (sdkConfig) {
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(sdkConfig);
  }

  const child = spawn('opencode', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
    detached: false,
  });

  let closed = false;

  const closeChild = async (): Promise<void> => {
    if (closed) return;
    closed = true;

    if (child.exitCode !== null || child.killed) return;

    child.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const killTimer = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
        resolve();
      }, SIGKILL_GRACE_MS);

      child.once('exit', () => {
        clearTimeout(killTimer);
        resolve();
      });
    });
  };

  return new Promise<OpencodeChild>((resolve, reject) => {
    const stderrChunks: string[] = [];
    const stdoutChunks: string[] = [];
    let stdoutLineBuffer = '';
    let stderrLineBuffer = '';
    let settled = false;

    const settleReady = (url: string) => {
      if (settled) return;
      settled = true;
      cleanup();

      const client = createOpencodeClient({ baseUrl: url });

      resolve({
        client,
        url,
        pid: child.pid!,
        close: closeChild,
      });
    };

    const settleError = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const timeout = setTimeout(() => {
      settleError(
        new Error(
          `opencode child did not become ready within ${startTimeoutMs}ms.\n` +
            `stdout: ${stdoutChunks.join('')}\n` +
            `stderr: ${stderrChunks.join('')}`,
        ),
      );
      void closeChild();
    }, startTimeoutMs);

    const onStdoutData = (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutChunks.push(text);
      stdoutLineBuffer += text;

      let lineEnd = stdoutLineBuffer.indexOf('\n');
      while (lineEnd >= 0) {
        const line = stdoutLineBuffer.slice(0, lineEnd).trim();
        stdoutLineBuffer = stdoutLineBuffer.slice(lineEnd + 1);

        const match = LISTENING_RE.exec(line);
        if (match?.[1]) {
          settleReady(match[1]);
          return;
        }

        lineEnd = stdoutLineBuffer.indexOf('\n');
      }

      const pendingMatch = LISTENING_RE.exec(stdoutLineBuffer);
      if (pendingMatch?.[1]) {
        settleReady(pendingMatch[1]);
      }
    };

    const onStderrData = (chunk: Buffer) => {
      const text = chunk.toString();
      stderrChunks.push(text);
      stderrLineBuffer += text;

      let lineEnd = stderrLineBuffer.indexOf('\n');
      while (lineEnd >= 0) {
        const line = stderrLineBuffer.slice(0, lineEnd).trim();
        stderrLineBuffer = stderrLineBuffer.slice(lineEnd + 1);

        if (FATAL_STARTUP_RE.test(line)) {
          settleError(
            new Error(
              `opencode child reported startup failure before ready: ${line}\n` +
                `stdout: ${stdoutChunks.join('')}\n` +
                `stderr: ${stderrChunks.join('')}`,
            ),
          );
          void closeChild();
          return;
        }

        lineEnd = stderrLineBuffer.indexOf('\n');
      }

      if (FATAL_STARTUP_RE.test(stderrLineBuffer)) {
        settleError(
          new Error(
            `opencode child reported startup failure before ready: ${stderrLineBuffer.trim()}\n` +
              `stdout: ${stdoutChunks.join('')}\n` +
              `stderr: ${stderrChunks.join('')}`,
          ),
        );
        void closeChild();
      }
    };

    const onChildExit = (code: number | null, signal: string | null) => {
      settleError(
        new Error(
          `opencode child exited before ready (code=${code}, signal=${signal}).\n` +
            `stdout: ${stdoutChunks.join('')}\n` +
            `stderr: ${stderrChunks.join('')}`,
        ),
      );
    };

    const onChildError = (err: Error) => {
      settleError(
        new Error(`opencode child spawn error: ${err.message}`, {
          cause: err,
        }),
      );
    };

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off('data', onStdoutData);
      child.stderr?.off('data', onStderrData);
      child.off('exit', onChildExit);
      child.off('error', onChildError);
    };
    child.stdout!.on('data', onStdoutData);
    child.stderr!.on('data', onStderrData);
    child.once('exit', onChildExit);
    child.once('error', onChildError);
  });
}
