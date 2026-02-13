/**
 * Dev-mode live-reload watcher for the daemon web dashboard.
 *
 * Watches frontend source files and agent renderer source files.
 * On change: re-syncs agent renderers (if needed), invalidates frontend
 * caches, and broadcasts a reload signal to all connected SSE clients.
 *
 * Only active when `JANITOR_DEV` environment variable is set.
 */

import { type FSWatcher, watch } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invalidateFrontendCaches } from './frontend';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEBOUNCE_MS = 200;

export function isDevMode(): boolean {
  const value = process.env.JANITOR_DEV;
  return value === '1' || value === 'true';
}

/**
 * Check whether an fs-watcher filename corresponds to an agent renderer
 * source file.  Matches `<agent>/renderers/<name>.js|css` regardless of path
 * separator style (`/` or `\`).
 */
export function isRendererSourceFilename(filename: string): boolean {
  return (
    (filename.endsWith('.js') || filename.endsWith('.css')) &&
    /[/\\]renderers[/\\]/.test(filename)
  );
}

export interface DevWatcher {
  /** Register an SSE controller for live-reload notifications. */
  addClient(controller: ReadableStreamDefaultController<Uint8Array>): void;
  /** Remove a disconnected SSE controller. */
  removeClient(controller: ReadableStreamDefaultController<Uint8Array>): void;
  /** Stop all watchers and clear clients. */
  stop(): void;
}

const SSE_ENCODER = new TextEncoder();

function sseReloadChunk(): Uint8Array {
  return SSE_ENCODER.encode(
    `event: reload\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`,
  );
}

/**
 * Resolve the watched directories relative to the CLI package source tree.
 */
function resolveWatchPaths(): {
  frontendDir: string;
  agentRenderersDir: string;
} {
  return {
    frontendDir: resolve(__dirname, 'frontend'),
    agentRenderersDir: resolve(__dirname, '../../../shared/src/agents'),
  };
}

export function createDevWatcher(): DevWatcher {
  const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const watchers: FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const paths = resolveWatchPaths();

  function broadcastReload(): void {
    const chunk = sseReloadChunk();
    for (const controller of clients) {
      try {
        controller.enqueue(chunk);
      } catch {
        clients.delete(controller);
      }
    }
  }

  function onFileChange(isRendererSource: boolean): void {
    if (stopped) return;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;

      if (isRendererSource) {
        try {
          const scriptPath = resolve(
            __dirname,
            '../../scripts/sync-agent-renderers.ts',
          );
          const result = Bun.spawnSync(['bun', 'run', scriptPath], {
            cwd: resolve(__dirname, '../../..'),
            stdout: 'pipe',
            stderr: 'pipe',
          });
          if (result.exitCode !== 0) {
            console.error(
              '[dev] renderer sync failed:',
              result.stderr.toString(),
            );
          } else {
            const output = result.stdout.toString().trim();
            if (output && output !== 'sync: up to date') {
              console.log(`[dev] ${output}`);
            }
          }
        } catch (error) {
          console.error('[dev] renderer sync failed:', error);
        }
      }

      invalidateFrontendCaches();
      broadcastReload();

      console.log(
        `[dev] file change detected, ${clients.size} client(s) notified`,
      );
    }, DEBOUNCE_MS);
  }

  // Watch frontend files
  try {
    const frontendWatcher = watch(
      paths.frontendDir,
      { recursive: true },
      (_event, filename) => {
        if (typeof filename === 'string' && filename.endsWith('.test.js')) {
          return;
        }
        onFileChange(false);
      },
    );
    watchers.push(frontendWatcher);
    console.log(`[dev] watching: ${paths.frontendDir}`);
  } catch (error) {
    console.error(`[dev] failed to watch frontend dir:`, error);
  }

  // Watch agent renderer source files
  try {
    const rendererWatcher = watch(
      paths.agentRenderersDir,
      { recursive: true },
      (_event, filename) => {
        if (
          typeof filename === 'string' &&
          isRendererSourceFilename(filename)
        ) {
          onFileChange(true);
        }
      },
    );
    watchers.push(rendererWatcher);
    console.log(`[dev] watching: ${paths.agentRenderersDir}`);
  } catch (error) {
    console.error(`[dev] failed to watch agent renderers dir:`, error);
  }

  return {
    addClient(controller) {
      clients.add(controller);
    },
    removeClient(controller) {
      clients.delete(controller);
    },
    stop() {
      stopped = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      for (const watcher of watchers) {
        watcher.close();
      }
      watchers.length = 0;
      clients.clear();
    },
  };
}
