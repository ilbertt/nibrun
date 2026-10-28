import { DEFAULT_AGENT_POLL_SETTINGS } from '#lib/agent-poll-settings.ts';

const REPORTS_BEFORE_SILENT = 3;
export const HOST_REPORT_MAX_AGE_MS =
  DEFAULT_AGENT_POLL_SETTINGS.reportIntervalMs * REPORTS_BEFORE_SILENT;
