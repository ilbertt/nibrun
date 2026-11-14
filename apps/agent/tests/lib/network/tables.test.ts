import { describe, expect, test } from 'bun:test';
import { parseKernelRuleset } from '#lib/network/tables.ts';
import { kernelRuleset } from '#tests/support/firewall.ts';

function fingerprint(value: unknown) {
  return parseKernelRuleset(JSON.stringify(value));
}

describe('the installed rules, including their order and policy, establish isolation', () => {
  test('the echoed transaction and kernel listing describe the same rules', () => {
    const snapshot = kernelRuleset();
    const echo = { nftables: [snapshot.nftables[0], ...snapshot.nftables].map((add) => ({ add })) };
    expect(fingerprint(snapshot)).toBeDefined();
    expect(fingerprint(echo)).toBe(fingerprint(snapshot));
  });

  test('a chain flushed without replacing its table is no longer verified', () => {
    const original = kernelRuleset();
    const flushed = { nftables: original.nftables.filter((entry) => !('rule' in entry)) };
    expect(fingerprint(flushed)).toBeUndefined();
  });

  test('a changed verdict cannot hide behind unchanged table handles', () => {
    const original = JSON.stringify(kernelRuleset());
    expect(parseKernelRuleset(original.replaceAll('"reject":null', '"accept":null'))).not.toBe(
      parseKernelRuleset(original),
    );
  });

  test('counter activity and unrelated tables do not invalidate isolation', () => {
    const original = kernelRuleset();
    const changed = JSON.parse(JSON.stringify(original).replaceAll('"bytes":0', '"bytes":12345'));
    changed.nftables.push({ table: { family: 'inet', name: 'other', handle: 9 } });
    expect(fingerprint(changed)).toBe(fingerprint(original));
  });

  test.each(['', 'not json', '{}', '{"nftables":[]}', '{"nftables":null}'])(
    'invalid output is never verified: %s',
    (value) => {
      expect(parseKernelRuleset(value)).toBeUndefined();
    },
  );

  test('a missing IPv6 table is not a verified firewall', () => {
    const snapshot = kernelRuleset();
    expect(
      fingerprint({
        nftables: snapshot.nftables.filter((entry) => JSON.stringify(entry).includes('"ip"')),
      }),
    ).toBeUndefined();
  });
});
