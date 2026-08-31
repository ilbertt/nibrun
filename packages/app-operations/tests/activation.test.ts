import { expect, test } from 'bun:test';
import { MAX_IDLE_TIMEOUT_MS, MIN_IDLE_TIMEOUT_MS } from '@repo/protocol';
import {
  type ActivationEdit,
  activationSummary,
  IDLE_TIMEOUT_CHOICES,
  idleTimeoutLabel,
  parseIdleTimeout,
  setActivation,
} from '#activation.ts';
import { InvalidIdleTimeoutError } from '#errors.ts';
import { answering, apiHolding } from '#tests/support/api.ts';
import { APP_ID, SLUG } from '#tests/support/app.ts';

const FIFTEEN_MINUTES_MS = 900_000;
const NINETY_MINUTES_MS = 5_400_000;
const TWO_HOURS_MS = 7_200_000;
const SIX_HOURS_MS = 21_600_000;

type Asked = { appId: string; edit: ActivationEdit };

// The stored side of the patch, said the way `COALESCE` says it: what the edit leaves out is what
// the app already had.
function apiRecording(asked: Asked[]) {
  return apiHolding({
    underApp: ({ appId }) => ({
      activation: {
        patch: (edit: ActivationEdit) => {
          asked.push({ appId, edit });
          return answering({
            slug: SLUG,
            activation: edit.activation ?? 'on-request',
            idleTimeoutMs: edit.idleTimeoutMs ?? FIFTEEN_MINUTES_MS,
          })();
        },
      },
    }),
  });
}

// The whole point of the patch: an owner turning the saving off has said nothing about the
// timeout, and a request restating one would overwrite what they chose with what was on screen.
test('an edit sends only what it names', async () => {
  const asked: Asked[] = [];

  await setActivation({ api: apiRecording(asked), appId: APP_ID, edit: { activation: 'always' } });

  expect(asked).toEqual([{ appId: APP_ID, edit: { activation: 'always' } }]);
});

test('and a timeout can be changed without restating the activation', async () => {
  const asked: Asked[] = [];

  const app = await setActivation({
    api: apiRecording(asked),
    appId: APP_ID,
    edit: { idleTimeoutMs: TWO_HOURS_MS },
  });

  expect(asked).toEqual([{ appId: APP_ID, edit: { idleTimeoutMs: TWO_HOURS_MS } }]);
  expect(app).toEqual({ slug: SLUG, activation: 'on-request', idleTimeoutMs: TWO_HOURS_MS });
});

test('the timeout is only read where it decides something', () => {
  expect(activationSummary({ activation: 'always', idleTimeoutMs: FIFTEEN_MINUTES_MS })).toBe(
    'Always on',
  );
  expect(activationSummary({ activation: 'on-request', idleTimeoutMs: FIFTEEN_MINUTES_MS })).toBe(
    'On request, stopped after 15m of quiet',
  );
});

test('a timeout reads back the way it was written', () => {
  expect(idleTimeoutLabel(MIN_IDLE_TIMEOUT_MS)).toBe('1m');
  expect(idleTimeoutLabel(FIFTEEN_MINUTES_MS)).toBe('15m');
  expect(idleTimeoutLabel(TWO_HOURS_MS)).toBe('2h');
});

// Rounding to the nearest hour would name a wait of ninety minutes as one twice that long, which
// is the one thing a label on a number must not do.
test('a wait that is not whole hours stays in minutes rather than rounding to one', () => {
  expect(idleTimeoutLabel(NINETY_MINUTES_MS)).toBe('90m');
});

test('every offered timeout is one a host could keep', () => {
  expect(IDLE_TIMEOUT_CHOICES.length).toBeGreaterThan(0);
  expect(IDLE_TIMEOUT_CHOICES.every((ms) => ms >= MIN_IDLE_TIMEOUT_MS)).toBe(true);
});

test('a duration is read in whichever unit it was written in', () => {
  expect(parseIdleTimeout('15m')).toBe(FIFTEEN_MINUTES_MS);
  expect(parseIdleTimeout('2h')).toBe(TWO_HOURS_MS);
  expect(parseIdleTimeout('60s')).toBe(MIN_IDLE_TIMEOUT_MS);
});

// Refused here rather than left to the api, whose answer is a schema failure quoting a field path.
test('a timeout the host could not keep is refused where it was typed', () => {
  expect(() => parseIdleTimeout('30s')).toThrow(InvalidIdleTimeoutError);
  expect(() => parseIdleTimeout('15')).toThrow(InvalidIdleTimeoutError);
  expect(() => parseIdleTimeout('soon')).toThrow(InvalidIdleTimeoutError);
});

// The ceiling only ever catches a slipped zero, so the waits somebody could mean stay legal and
// `always` remains the way to say never.
test('a wait past a day is refused, and every wait short of one is not', () => {
  expect(parseIdleTimeout('24h')).toBe(MAX_IDLE_TIMEOUT_MS);
  expect(parseIdleTimeout('6h')).toBe(SIX_HOURS_MS);
  expect(() => parseIdleTimeout('25h')).toThrow(InvalidIdleTimeoutError);
});
