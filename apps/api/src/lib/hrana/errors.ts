import { HranaError } from '@repo/sqlite';

export function hranaError(error: unknown): { message: string; code: string } {
  if (error instanceof HranaError) {
    return { message: error.message, code: error.code };
  }
  return { message: 'SQLite request failed', code: 'SQLITE_ERROR' };
}
