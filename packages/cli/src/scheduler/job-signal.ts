/**
 * Lightweight scheduler wake signal.
 *
 * Producers call `notify()` when new jobs are enqueued.
 * Scheduler waits on `wait(timeoutMs)` with fallback heartbeat timeout.
 */

export interface JobSignal {
  notify(): void;
  wait(timeoutMs: number): Promise<void>;
}

export function createJobSignal(): JobSignal {
  const waiters = new Set<() => void>();

  return {
    notify() {
      const pending = [...waiters];
      waiters.clear();
      for (const resume of pending) {
        resume();
      }
    },

    wait(timeoutMs: number) {
      return new Promise<void>((resolve) => {
        const resume = () => {
          clearTimeout(timeout);
          waiters.delete(resume);
          resolve();
        };

        const timeout = setTimeout(() => {
          waiters.delete(resume);
          resolve();
        }, timeoutMs);

        waiters.add(resume);
      });
    },
  };
}
