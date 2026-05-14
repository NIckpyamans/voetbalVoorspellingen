export type LogLevel = "debug" | "info" | "warning" | "error";

export interface Logger {
  debug(event: string, details?: Record<string, unknown>): void;
  info(event: string, details?: Record<string, unknown>): void;
  warning(event: string, details?: Record<string, unknown>): void;
  error(event: string, details?: Record<string, unknown>): void;
  timeAsync<T>(event: string, fn: () => Promise<T>, details?: Record<string, unknown>): Promise<T>;
}

export function createLogger(scope?: string): Logger;
export function getErrorDetails(error: unknown): Record<string, unknown>;
