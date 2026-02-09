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
