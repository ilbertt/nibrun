import type { HranaErrorSchema } from '#hrana.ts';

export class HranaError extends Error {
  readonly code: string;

  constructor({ message, code }: { message: string; code: string }) {
    super(message);
    this.name = 'HranaError';
    this.code = code;
  }
}

export function hranaError(error: unknown): typeof HranaErrorSchema.static {
  if (error instanceof HranaError) {
    return { message: error.message, code: error.code };
  }
  return { message: 'SQLite request failed', code: 'SQLITE_ERROR' };
}
