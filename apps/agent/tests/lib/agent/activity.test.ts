import { describe, expect, test } from 'bun:test';
import { type AppId, AppIdSchema, Value } from '@repo/protocol';
import { type Activity, activityAfter } from '#lib/agent/activity.ts';
import { parseAppTraffic } from '#lib/network/counters.ts';
import { appCounterName } from '#lib/network/firewall.ts';

const APP = Value.Parse(AppIdSchema, '0198f3aa-1c2d-7e4b-9f11-a0b1c2d3e4f5');
const OTHER = Value.Parse(AppIdSchema, '0198f3bb-2d3e-7f5c-8a22-b1c2d3e4f5a6');

const EARLIER = 1_000;
const NOW = 60_000;

const SOME_BYTES = 1_024;
const MORE_BYTES = 2_048;
const FIRST_BYTES = 4_096;
const A_LOT_OF_BYTES = 9_000_000;
/** What a freshly written table has counted: not nothing, but far below what stood before it. */
const AFTER_A_RESET = 16;
const READ_PACKETS = 3;
const READ_BYTES = 512;
const OTHER_READ_BYTES = 1_024;
const A_FEW_BYTES = 8;
const NOT_A_NAME = 5;
const EXPECTED_APPS = 2;
/** One past the 63 an identifier may be. */
const TOO_LONG = 64;
const BEFORE_BYTES = 10;
const AFTER_BYTES = 20;

const empty: Activity = { traffic: new Map(), lastActiveAtMs: new Map() };

function previously({ bytes, at }: { bytes: number; at: number }): Activity {
  return {
    traffic: new Map([[APP, { packets: 1, bytes }]]),
    lastActiveAtMs: new Map([[APP, at]]),
  };
}

const reading = (bytes: number) => new Map([[APP, { packets: 1, bytes }]]);

describe('an app is active when its counter has moved', () => {
  test('more bytes than last time is the app being used', () => {
    const after = activityAfter({
      taken: reading(MORE_BYTES),
      previous: previously({ bytes: SOME_BYTES, at: EARLIER }),
      nowMs: NOW,
    });
    expect(after.lastActiveAtMs.get(APP)).toBe(NOW);
  });

  test('the same bytes as last time leaves the moment where it was', () => {
    const after = activityAfter({
      taken: reading(SOME_BYTES),
      previous: previously({ bytes: SOME_BYTES, at: EARLIER }),
      nowMs: NOW,
    });
    expect(after.lastActiveAtMs.get(APP)).toBe(EARLIER);
  });

  test('the first reading starts the clock rather than answering it', () => {
    const after = activityAfter({ taken: reading(FIRST_BYTES), previous: empty, nowMs: NOW });
    expect(after.lastActiveAtMs.get(APP)).toBe(NOW);
    expect(after.traffic.get(APP)?.bytes).toBe(FIRST_BYTES);
  });
});

describe('a rewritten ruleset is not an app going quiet', () => {
  test('a count below the one before it is a reset, and no evidence either way', () => {
    const after = activityAfter({
      taken: reading(AFTER_A_RESET),
      previous: previously({ bytes: A_LOT_OF_BYTES, at: EARLIER }),
      nowMs: NOW,
    });
    expect(after.lastActiveAtMs.get(APP)).toBe(EARLIER);
  });

  test('the reset reading becomes what the next one is measured against', () => {
    const after = activityAfter({
      taken: reading(AFTER_A_RESET),
      previous: previously({ bytes: A_LOT_OF_BYTES, at: EARLIER }),
      nowMs: NOW,
    });
    expect(after.traffic.get(APP)?.bytes).toBe(AFTER_A_RESET);
  });
});

describe('an app with no counter is not an app that was just used', () => {
  test('a stopped app keeps the moment it was last reached', () => {
    const after = activityAfter({
      taken: new Map(),
      previous: previously({ bytes: SOME_BYTES, at: EARLIER }),
      nowMs: NOW,
    });
    expect(after.lastActiveAtMs.get(APP)).toBe(EARLIER);
  });

  test('and stops being measured against a baseline it no longer has', () => {
    const after = activityAfter({
      taken: new Map(),
      previous: previously({ bytes: SOME_BYTES, at: EARLIER }),
      nowMs: NOW,
    });
    expect(after.traffic.has(APP)).toBe(false);
  });
});

describe('reading what the kernel reports', () => {
  const counters = (entries: readonly { name: string; bytes: number }[]) =>
    JSON.stringify({
      nftables: [
        { metainfo: { version: '1.0.4' } },
        ...entries.map(({ name, bytes }) => ({
          counter: { family: 'ip', name, table: 'nibrun', handle: 2, packets: READ_PACKETS, bytes },
        })),
      ],
    });

  test('a counter is attributed by its name', () => {
    const traffic = parseAppTraffic(counters([{ name: appCounterName(APP), bytes: READ_BYTES }]));
    expect(traffic.get(APP)).toEqual({ packets: READ_PACKETS, bytes: READ_BYTES });
  });

  test('every app in the table is read, not just the first', () => {
    const traffic = parseAppTraffic(
      counters([
        { name: appCounterName(APP), bytes: READ_BYTES },
        { name: appCounterName(OTHER), bytes: OTHER_READ_BYTES },
      ]),
    );
    expect(traffic.size).toBe(EXPECTED_APPS);
    expect(traffic.get(OTHER)?.bytes).toBe(OTHER_READ_BYTES);
  });

  test('a counter that is not an app is somebody else’s and is skipped', () => {
    expect(parseAppTraffic(counters([{ name: 'something_else', bytes: A_FEW_BYTES }])).size).toBe(
      0,
    );
  });

  // An app id is opaque — `identifierSchema` takes any `[0-9A-Za-z][0-9A-Za-z_-]{0,62}` — so the
  // prefix is what attributes a counter, and the schema only refuses a name no id could be.
  test('a name no app id could take is skipped rather than parsed into one', () => {
    expect(parseAppTraffic(counters([{ name: 'app_has.a.dot', bytes: A_FEW_BYTES }])).size).toBe(0);
    expect(
      parseAppTraffic(counters([{ name: `app_${'x'.repeat(TOO_LONG)}`, bytes: A_FEW_BYTES }])).size,
    ).toBe(0);
  });

  test('output that is not the shape this expects reads as nothing measured', () => {
    expect(parseAppTraffic('not json').size).toBe(0);
    expect(parseAppTraffic('{}').size).toBe(0);
    expect(
      parseAppTraffic(JSON.stringify({ nftables: [{ counter: { name: NOT_A_NAME } }] })).size,
    ).toBe(0);
  });
});

describe('what the host stops holding, it stops answering about', () => {
  test('an app still held keeps its history across a pass', () => {
    const first = activityAfter({ taken: reading(BEFORE_BYTES), previous: empty, nowMs: EARLIER });
    const second = activityAfter({ taken: reading(AFTER_BYTES), previous: first, nowMs: NOW });
    expect(second.lastActiveAtMs.get(APP as AppId)).toBe(NOW);
  });
});
