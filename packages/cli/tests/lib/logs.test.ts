import { describe, expect, test } from 'bun:test';
import type { Print } from '@parshjs/core';
import type { TenantLogRecord } from '@repo/protocol';
import { render, show } from '#lib/logs.ts';

const DROPPED_BYTES = 4096;
const ESCAPE_CODE = 27;

function record(overrides: Partial<TenantLogRecord> = {}): TenantLogRecord {
  return {
    _time: '2026-08-06T09:41:00.123Z',
    _msg: 'listening on 0.0.0.0:8090',
    hostId: 'host-1',
    SOURCE: 'tenant',
    appId: 'app-1',
    deploymentId: 'deployment-1',
    stream: 'stdout',
    sourceId: 'source-1',
    sequence: 0,
    ...overrides,
  } as TenantLogRecord;
}

/** Which level a record went out at is the whole of what `show` decides. */
function printer(): Print & { at: string[] } {
  const at: string[] = [];
  return {
    at,
    info: () => at.push('info'),
    success: () => at.push('success'),
    warn: () => at.push('warn'),
    error: () => at.push('error'),
    dim: () => at.push('dim'),
  };
}

const ESCAPE = String.fromCharCode(ESCAPE_CODE);
const ANSI = new RegExp(`${ESCAPE}\\[\\d+m`, 'g');
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$/;

/** The three columns `render` lays out, with whatever styling it wrapped them in taken back off. */
function columns(line: string) {
  const [stamp = '', mark = '', ...rest] = line.replace(ANSI, '').split('  ');
  return { stamp, mark, message: rest.join('  ') };
}

/**
 * Rendering as it would reach a terminal. Nothing in a test run is one, so styling is off unless
 * asked for — and `NO_COLOR` has to go while it is, since a environment that sets it wins.
 */
function withColour(rendering: () => string): string {
  const { NO_COLOR, FORCE_COLOR } = process.env;
  delete process.env.NO_COLOR;
  process.env.FORCE_COLOR = '1';
  try {
    return rendering();
  } finally {
    restore({ name: 'NO_COLOR', value: NO_COLOR });
    restore({ name: 'FORCE_COLOR', value: FORCE_COLOR });
  }
}

function restore({ name, value }: { name: string; value: string | undefined }): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe('a record is one line of what the app wrote', () => {
  test('the line is the message, behind the stream it came out of', () => {
    const { mark, message } = columns(render(record()));

    expect(mark).toBe('out');
    expect(message).toBe('listening on 0.0.0.0:8090');
  });

  // Stamped in the reader's own timezone, so the text depends on where the test runs and the
  // instant it stands for does not.
  test('the stamp is RFC 3339 for the instant the record carries', () => {
    const { stamp } = columns(render(record()));

    expect(stamp).toMatch(RFC3339);
    expect(Date.parse(stamp)).toBe(Date.parse('2026-08-06T09:41:00.123Z'));
  });

  test('what the app wrote to its error stream is labelled as such', () => {
    expect(columns(render(record({ stream: 'stderr' }))).mark).toBe('err');
  });

  // The store keeps the newline the guest wrote and printing supplies another, which is a blank
  // line between every two records.
  test('the newline that ended the message is not printed a second time', () => {
    const line = render(record({ _msg: 'listening on 0.0.0.0:8090\n' }));

    expect(line).not.toInclude('\n');
    expect(columns(line).message).toBe('listening on 0.0.0.0:8090');
  });

  // Trailing spaces are the app's own, and only the terminator is this program's to remove.
  test('what the app wrote is otherwise left alone', () => {
    expect(columns(render(record({ _msg: 'waiting...  ' }))).message).toBe('waiting...  ');
  });

  // A gap stands for output the host had to drop, and how much is the whole of what it says.
  test('a gap says how much went missing', () => {
    const line = render(record({ stream: 'stderr', droppedBytes: DROPPED_BYTES }));

    expect(line).toEndWith(`(${DROPPED_BYTES} bytes)`);
  });
});

describe('only the part of a line the app did not write is dimmed', () => {
  test('the stamp and the stream mark are, and the message is not', () => {
    const line = withColour(() => render(record()));

    expect(line).toStartWith(`${ESCAPE}[2m`);
    expect(line).toEndWith(`${ESCAPE}[22m  listening on 0.0.0.0:8090`);
  });

  // Styling a line nobody will look at leaves escapes in whatever the output was redirected into.
  test('a stream that is not a terminal is written plainly', () => {
    expect(render(record())).not.toInclude(ESCAPE);
  });
});

describe('the stream a record came out of is the stream it goes back into', () => {
  test('ordinary output is written plainly to ours', () => {
    const print = printer();

    show({ record: record(), print });

    expect(print.at).toEqual(['info']);
  });

  test('what the app wrote to its error stream goes to ours', () => {
    const print = printer();

    show({ record: record({ stream: 'stderr' }), print });

    expect(print.at).toEqual(['error']);
  });

  // A gap is the host speaking, not the app, so it is not dressed as the app's own error output.
  test('a gap is a warning rather than the app error output', () => {
    const print = printer();

    show({ record: record({ stream: 'stderr', droppedBytes: DROPPED_BYTES }), print });

    expect(print.at).toEqual(['warn']);
  });
});
