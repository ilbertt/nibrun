import { describe, expect, test } from 'bun:test';
import { parseProperties, parsePropertyBlocks } from '#lib/systemd-properties.ts';

describe('show output', () => {
  test('properties split on the first equals, so values may contain one', () => {
    expect(parseProperties('LoadState=loaded\nExecStart=/bin/x --a=b')).toEqual({
      LoadState: 'loaded',
      ExecStart: '/bin/x --a=b',
    });
  });

  test('several units come back in one call, one block per unit', () => {
    const blocks = parsePropertyBlocks(
      'LoadState=loaded\nActiveState=active\n\nLoadState=not-found\nActiveState=inactive\n',
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.LoadState).toBe('not-found');
  });
});
