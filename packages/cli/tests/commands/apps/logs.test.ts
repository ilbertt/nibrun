import { expect, test } from 'bun:test';
import { command } from '#commands/apps/logs.ts';

test('logs defaults to five minutes of history when timerange is omitted', () => {
  expect(command.options.timerange.schema.parse(undefined)).toBe('5m');
});

test.each(['30s', '5m', '2h', '9999h'])('logs accepts timerange %s', (timerange) => {
  expect(command.options.timerange.schema.parse(timerange)).toBe(timerange);
});

test.each(['forever', '0m', '01m', '1d', '10000h', ''])(
  'logs rejects timerange %s locally',
  (timerange) => {
    const parsed = command.options.timerange.schema.safeParse(timerange);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe(
        'A timerange is a duration such as 30s, 5m or 2h.',
      );
    }
  },
);
