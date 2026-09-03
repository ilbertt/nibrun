import { describe, expect, test } from 'bun:test';
import { parseKernelTables } from '#lib/network/tables.ts';

const METAINFO =
  '{"metainfo": {"version": "1.0.4", "release_name": "Lester Gooch #3", "json_schema_version": 1}}';

const listing = (...tables: readonly string[]) =>
  `{"nftables": [${[METAINFO, ...tables].join(', ')}]}`;

const nibrun = ({ family, handle }: { family: string; handle: number }) =>
  `{"table": {"family": "${family}", "name": "nibrun", "handle": ${handle}}}`;

/** What AL2023 with nft 1.0.4 answers right after the agent has written both tables. */
const HOLDING_BOTH = listing(
  nibrun({ family: 'ip', handle: 2 }),
  nibrun({ family: 'ip6', handle: 4 }),
);

/** The same host after `nft flush ruleset`, which succeeds and names no table at all. */
const FLUSHED = listing();

describe('what the kernel is holding', () => {
  test('a host holding both tables reads back as itself', () => {
    expect(parseKernelTables(HOLDING_BOTH)).toBe(parseKernelTables(HOLDING_BOTH));
    expect(parseKernelTables(HOLDING_BOTH)).not.toBe('');
  });

  test('a flushed ruleset is not the host that was holding them', () => {
    expect(parseKernelTables(FLUSHED)).not.toBe(parseKernelTables(HOLDING_BOTH));
  });

  test('tables rebuilt by something else carry new handles and read back different', () => {
    const rebuilt = listing(
      nibrun({ family: 'ip', handle: 8 }),
      nibrun({ family: 'ip6', handle: 10 }),
    );
    expect(parseKernelTables(rebuilt)).not.toBe(parseKernelTables(HOLDING_BOTH));
  });

  test('half the pair is not the pair', () => {
    const onlyV4 = listing(nibrun({ family: 'ip', handle: 2 }));
    expect(parseKernelTables(onlyV4)).not.toBe(parseKernelTables(HOLDING_BOTH));
  });

  test('the families are named in one order, whatever order the kernel lists them in', () => {
    const reversed = listing(
      nibrun({ family: 'ip6', handle: 4 }),
      nibrun({ family: 'ip', handle: 2 }),
    );
    expect(parseKernelTables(reversed)).toBe(parseKernelTables(HOLDING_BOTH));
  });

  test('a table belonging to something else on the host is not ours', () => {
    const alongside = listing(
      '{"table": {"family": "inet", "name": "filter", "handle": 1}}',
      nibrun({ family: 'ip', handle: 2 }),
      nibrun({ family: 'ip6', handle: 4 }),
    );
    expect(parseKernelTables(alongside)).toBe(parseKernelTables(HOLDING_BOTH));
  });

  test('a name that matches in another family is not one of the two written', () => {
    const bridged = listing(
      nibrun({ family: 'ip', handle: 2 }),
      nibrun({ family: 'ip6', handle: 4 }),
      nibrun({ family: 'bridge', handle: 6 }),
    );
    expect(parseKernelTables(bridged)).toBe(parseKernelTables(HOLDING_BOTH));
  });
});

describe('output that cannot be read is a host holding nothing', () => {
  test('output that is not json', () => {
    expect(parseKernelTables('nft: command not found')).toBe('');
  });

  test('json that is not an nftables answer', () => {
    expect(parseKernelTables('{"other": []}')).toBe('');
  });

  test('a table the kernel named without a handle', () => {
    expect(parseKernelTables(listing('{"table": {"family": "ip", "name": "nibrun"}}'))).toBe('');
  });
});
