import { describe, expect, test } from 'bun:test';
import {
  HANDOFF_OFFER,
  HANDOFF_READY,
  HANDOFF_STORED,
  isHandoffOffer,
  isHandoffReady,
  isHandoffStored,
} from '#messages.ts';

// These guards stand between an arbitrary page and the app's storage, so what they reject
// matters more than what they accept.
describe('a message is only trusted for what it actually carries', () => {
  test('an offer needs a real File, not something shaped like one', () => {
    const binary = new File(['#!/bin/sh'], 'server');

    expect(isHandoffOffer({ kind: HANDOFF_OFFER, binary })).toBe(true);
    expect(isHandoffOffer({ kind: HANDOFF_OFFER, binary: { name: 'server', size: 9 } })).toBe(
      false,
    );
    expect(isHandoffOffer({ kind: HANDOFF_OFFER })).toBe(false);
    expect(isHandoffOffer({ kind: HANDOFF_OFFER, binary: new Blob(['#!/bin/sh']) })).toBe(false);
  });

  test('a kind is not enough on its own', () => {
    expect(isHandoffOffer({ kind: HANDOFF_READY, binary: new File([], 'server') })).toBe(false);
    expect(isHandoffReady({ kind: HANDOFF_STORED })).toBe(false);
    expect(isHandoffStored({ kind: HANDOFF_READY })).toBe(false);
  });

  test('anything that is not a message is refused rather than thrown at', () => {
    // A window accepts a post of any shape, so the guards have to survive all of them.
    const notMessages: unknown[] = [
      null,
      undefined,
      'handoff-offer',
      Number.NaN,
      [],
      new File([], 'server'),
    ];

    for (const value of notMessages) {
      expect(isHandoffOffer(value)).toBe(false);
      expect(isHandoffReady(value)).toBe(false);
      expect(isHandoffStored(value)).toBe(false);
    }
  });

  test('the signals carry nothing beyond their kind', () => {
    expect(isHandoffReady({ kind: HANDOFF_READY })).toBe(true);
    expect(isHandoffStored({ kind: HANDOFF_STORED })).toBe(true);
  });
});
