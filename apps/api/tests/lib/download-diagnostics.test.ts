import { expect, test } from 'bun:test';
import { DownloadDiagnostics, downloadOrigin } from '#lib/download-diagnostics.ts';
import { recordingDownloadLogger } from '#tests/support/download-logs.ts';

const DOWNLOAD_ID = 'download-test';
const APP_ID = 'app-test';
const SECRET = 'private-download-token';
const SOURCE = `https://user:${SECRET}@releases.example/${SECRET}?signature=${SECRET}#${SECRET}`;

test('a pending phase is visible before it finishes and keeps its correlation context', async () => {
  const { logger, records } = recordingDownloadLogger();
  const diagnostics = new DownloadDiagnostics({
    downloadId: DOWNLOAD_ID,
    fields: { appId: APP_ID, origin: downloadOrigin(SOURCE) },
    logger,
  });
  const pending = Promise.withResolvers<string>();
  const operation = diagnostics.phase({ phase: 'storage-copy', run: () => pending.promise });
  expect(records).toEqual([
    expect.objectContaining({
      phase: 'storage-copy',
      event: 'started',
      downloadId: DOWNLOAD_ID,
      appId: APP_ID,
      origin: 'https://releases.example',
    }),
  ]);
  pending.resolve('stored');
  expect(await operation).toBe('stored');
  expect(records.at(-1)).toMatchObject({
    phase: 'storage-copy',
    event: 'completed',
    downloadId: DOWNLOAD_ID,
    durationMs: expect.any(Number),
    elapsedMs: expect.any(Number),
  });
  expect(JSON.stringify(records)).not.toContain(SECRET);
});

test('failures keep diagnostic codes and omit error messages, stacks and unsafe metadata', async () => {
  const { logger, records } = recordingDownloadLogger();
  const diagnostics = new DownloadDiagnostics({ logger });
  const error = Object.assign(new Error(SOURCE), {
    code: 'ECONNRESET',
    syscall: 'connect',
    cause: { code: 'CERT_HAS_EXPIRED', message: SOURCE },
  });
  function fail(): Promise<never> {
    return Promise.reject(error);
  }
  await expect(diagnostics.phase({ phase: 'response', run: fail })).rejects.toBe(error);
  expect(records.at(-1)).toMatchObject({
    level: 'warn',
    phase: 'response',
    event: 'failed',
    errorName: 'Error',
    errorCode: 'ECONNRESET',
    syscall: 'connect',
    causeCode: 'CERT_HAS_EXPIRED',
  });
  diagnostics.failure({ phase: 'body', error: { name: SOURCE, code: SOURCE, syscall: SOURCE } });
  expect(JSON.stringify(records)).not.toContain(SECRET);
});

test('overlapping downloads get distinct identifiers', async () => {
  const { logger, records } = recordingDownloadLogger();
  const first = new DownloadDiagnostics({ logger });
  const second = new DownloadDiagnostics({ logger });
  await Promise.all([
    first.phase({ phase: 'first', run: () => Promise.resolve() }),
    second.phase({ phase: 'second', run: () => Promise.resolve() }),
  ]);
  expect(first.downloadId).not.toBe(second.downloadId);
  expect(records.filter((record) => record.downloadId === first.downloadId)).toHaveLength(2);
  expect(records.filter((record) => record.downloadId === second.downloadId)).toHaveLength(2);
});

test('malformed source URLs never fall back to logging the original text', () => {
  expect(downloadOrigin(`not a url ${SECRET}`)).toBeUndefined();
});

test('each diagnostic is one JSON record that can be searched by download identifier', () => {
  const lines: string[] = [];
  function record(...args: unknown[]) {
    expect(typeof args[1]).toBe('string');
    lines.push(String(args[1]));
  }
  const diagnostics = new DownloadDiagnostics({
    downloadId: DOWNLOAD_ID,
    logger: { info: record, warn: record },
  });
  diagnostics.event({ phase: 'response', event: 'started', host: 'releases.example' });
  diagnostics.failure({ phase: 'response', event: 'failed', error: new Error(SOURCE) });
  for (const line of lines) {
    expect(line).not.toContain('\n');
    expect(line).not.toContain(SECRET);
    expect(JSON.parse(line)).toMatchObject({ downloadId: DOWNLOAD_ID, phase: 'response' });
  }
});
