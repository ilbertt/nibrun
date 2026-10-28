import { createLogger } from '#lib/logger.ts';

export type DownloadLogger = Pick<ReturnType<typeof createLogger>, 'info' | 'warn'>;
type Fields = Record<string, unknown>;
const ERROR_TOKEN = /^[\w.-]{1,80}$/;

export function downloadOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function errorToken({ error, key }: { error: unknown; key: string }): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const value: unknown = Reflect.get(error, key);
  return typeof value === 'string' && ERROR_TOKEN.test(value) ? value : undefined;
}

function failureDetails(error: unknown): Fields {
  const cause: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'cause') : undefined;
  return {
    errorName: errorToken({ error, key: 'name' }),
    errorCode: errorToken({ error, key: 'code' }),
    syscall: errorToken({ error, key: 'syscall' }),
    causeCode: errorToken({ error: cause, key: 'code' }),
  };
}

export class DownloadDiagnostics {
  readonly downloadId: string;
  private readonly logger: DownloadLogger;
  private readonly fields: Fields;
  private readonly startedAt = performance.now();

  constructor({
    downloadId = crypto.randomUUID(),
    logger = createLogger('Downloader'),
    fields = {},
  }: {
    downloadId?: string;
    logger?: DownloadLogger;
    fields?: Fields;
  } = {}) {
    this.downloadId = downloadId;
    this.logger = logger;
    this.fields = fields;
  }

  event(fields: Fields): void {
    this.logger.info('download', JSON.stringify(this.context(fields)));
  }

  failure({ error, ...fields }: Fields & { error: unknown }): void {
    this.logger.warn(
      'download',
      JSON.stringify(this.context({ ...fields, ...failureDetails(error) })),
    );
  }

  async phase<T>({
    phase,
    run,
    fields = {},
    result,
    deadline,
  }: {
    phase: string;
    run: () => Promise<T>;
    fields?: Fields;
    result?: (value: T) => Fields;
    deadline?: AbortSignal;
  }): Promise<T> {
    const startedAt = performance.now();
    this.event({ ...fields, phase, event: 'started' });
    try {
      const value = await run();
      this.event({
        ...fields,
        ...result?.(value),
        phase,
        event: 'completed',
        durationMs: Math.round(performance.now() - startedAt),
      });
      return value;
    } catch (error) {
      this.failure({
        ...fields,
        phase,
        event: 'failed',
        durationMs: Math.round(performance.now() - startedAt),
        totalDeadlineExceeded: deadline?.aborted,
        error,
      });
      throw error;
    }
  }

  private context(fields: Fields): Fields {
    return {
      ...this.fields,
      ...fields,
      downloadId: this.downloadId,
      elapsedMs: Math.round(performance.now() - this.startedAt),
    };
  }
}
