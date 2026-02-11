import { request } from 'node:http';

interface JsonRequestOptions {
  socketPath: string;
  path: string;
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT';
  body?: unknown;
  timeoutMs?: number;
}

export interface JsonResponse<T> {
  status: number;
  data: T;
}

export function requestJson<T>(
  options: JsonRequestOptions,
): Promise<JsonResponse<T>> {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : undefined;

    const req = request(
      {
        socketPath: options.socketPath,
        path: options.path,
        method: options.method ?? 'GET',
        headers: body
          ? {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(body),
            }
          : undefined,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = raw ? (JSON.parse(raw) as T) : ({} as T);
            resolve({ status: res.statusCode ?? 0, data: parsed });
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    req.on('error', (error) => {
      reject(error);
    });

    req.setTimeout(options.timeoutMs ?? 3000, () => {
      req.destroy(new Error('IPC request timed out'));
    });

    if (body) {
      req.write(body);
    }

    req.end();
  });
}

interface SseRequestOptions {
  socketPath: string;
  path: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  onEvent: (event: string, payload: unknown) => void;
}

/** Subscribe to a daemon SSE endpoint over unix socket. */
export function requestSse(options: SseRequestOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: options.socketPath,
        path: options.path,
        method: 'GET',
        headers: {
          accept: 'text/event-stream',
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          let errorBody = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            errorBody += chunk;
          });
          res.on('end', () => {
            reject(
              new Error(
                `SSE request failed with status ${res.statusCode}: ${errorBody}`,
              ),
            );
          });
          return;
        }

        let buffer = '';
        let eventName = 'message';
        let dataLines: string[] = [];

        const flush = () => {
          if (dataLines.length === 0) {
            eventName = 'message';
            return;
          }

          const raw = dataLines.join('\n');
          let payload: unknown = raw;
          try {
            payload = JSON.parse(raw);
          } catch {
            // keep raw text payload
          }

          options.onEvent(eventName, payload);
          eventName = 'message';
          dataLines = [];
        };

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;

          let lineBreak = buffer.indexOf('\n');
          while (lineBreak >= 0) {
            const line = buffer.slice(0, lineBreak).replace(/\r$/, '');
            buffer = buffer.slice(lineBreak + 1);

            if (line === '') {
              flush();
            } else if (line.startsWith('event:')) {
              eventName = line.slice('event:'.length).trim() || 'message';
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice('data:'.length).trim());
            }

            lineBreak = buffer.indexOf('\n');
          }
        });

        res.on('end', () => {
          flush();
          resolve();
        });

        res.on('error', (error) => {
          reject(error);
        });
      },
    );

    req.on('error', (error) => {
      reject(error);
    });

    if (options.timeoutMs && options.timeoutMs > 0) {
      req.setTimeout(options.timeoutMs, () => {
        req.destroy(new Error('IPC SSE request timed out'));
      });
    }

    if (options.signal) {
      if (options.signal.aborted) {
        req.destroy(new Error('IPC SSE request aborted'));
      } else {
        options.signal.addEventListener(
          'abort',
          () => {
            req.destroy(new Error('IPC SSE request aborted'));
          },
          { once: true },
        );
      }
    }

    req.end();
  });
}
