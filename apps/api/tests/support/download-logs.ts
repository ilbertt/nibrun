import type { DownloadLogger } from '#lib/download-diagnostics.ts';

function logFields(value: unknown): Record<string, unknown> {
  return typeof value === 'string' ? JSON.parse(value) : (value as Record<string, unknown>);
}

export function recordingDownloadLogger() {
  const records: Record<string, unknown>[] = [];
  function info(...args: unknown[]) {
    records.push({ level: 'info', ...logFields(args[1]) });
  }
  function warn(...args: unknown[]) {
    records.push({ level: 'warn', ...logFields(args[1]) });
  }
  const logger: DownloadLogger = { info, warn };
  return { records, logger };
}
