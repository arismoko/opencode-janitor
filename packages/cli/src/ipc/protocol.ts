export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export interface HealthResponse {
  ok: true;
  pid: number;
  version: string;
  uptimeMs: number;
}

export interface DaemonStatusResponse {
  ok: true;
  pid: number;
  uptimeMs: number;
  draining: boolean;
  socketPath: string;
  dbPath: string;
}

export interface StopResponse {
  ok: true;
  draining: true;
}
