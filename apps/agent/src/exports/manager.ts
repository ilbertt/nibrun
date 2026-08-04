import type { ReportedExport } from '@repo/protocol';

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Structural, like `readInstanceRecords`: this is the agent's own note of what it wrote. */
const isReportedExport = (value: unknown): value is ReportedExport =>
  isObject(value) && typeof value.exportId === 'string' && typeof value.state === 'string';

export function readExportReports(value: unknown): ReportedExport[] {
  return Array.isArray(value) ? value.filter(isReportedExport) : [];
}
