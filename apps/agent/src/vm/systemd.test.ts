import { describe, expect, test } from 'bun:test';
import type { InstanceId } from '@repo/protocol';
import {
  instanceIdFromUnit,
  parseProperties,
  parsePropertyBlocks,
  parseUnitNames,
  unitStatusFrom,
  vmUnitName,
} from '#vm/systemd.ts';

describe('unit naming round-trips', () => {
  test('an instance id becomes a template instance and back', () => {
    const instanceId = 'inst-A_1' as InstanceId;
    expect(vmUnitName(instanceId)).toBe('nibrun-vm@inst-A_1.service');
    expect(instanceIdFromUnit(vmUnitName(instanceId))).toBe(instanceId);
  });

  test('a unit that is not ours is ignored', () => {
    expect(instanceIdFromUnit('sshd.service')).toBeUndefined();
    expect(instanceIdFromUnit('nibrun-vm@inst-1.socket')).toBeUndefined();
  });

  test('an instance name that is not a valid identifier is refused', () => {
    expect(instanceIdFromUnit('nibrun-vm@..\\x2fetc.service')).toBeUndefined();
    expect(instanceIdFromUnit('nibrun-vm@.service')).toBeUndefined();
  });
});

describe('list-units output', () => {
  test('unit names are read past the status glyph systemd prefixes failures with', () => {
    const output = [
      'nibrun-vm@inst-1.service loaded active running nibrun microVM inst-1',
      '● nibrun-vm@inst-2.service loaded failed failed nibrun microVM inst-2',
      '',
    ].join('\n');
    expect(parseUnitNames(output)).toEqual([
      'nibrun-vm@inst-1.service',
      'nibrun-vm@inst-2.service',
    ]);
  });

  test('an empty listing yields nothing rather than an empty name', () => {
    expect(parseUnitNames('')).toEqual([]);
  });
});

describe('show output', () => {
  test('properties split on the first equals, so values may contain one', () => {
    expect(parseProperties('LoadState=loaded\nExecStart=/bin/x --a=b')).toEqual({
      LoadState: 'loaded',
      ExecStart: '/bin/x --a=b',
    });
  });

  test('several units come back in one call, in the order asked', () => {
    const blocks = parsePropertyBlocks(
      'LoadState=loaded\nActiveState=active\n\nLoadState=not-found\nActiveState=inactive\n',
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[1]?.LoadState).toBe('not-found');
  });
});

describe('unit status', () => {
  test('active and activating both count as up', () => {
    expect(unitStatusFrom({ LoadState: 'loaded', ActiveState: 'active' }).active).toBe(true);
    expect(unitStatusFrom({ LoadState: 'loaded', ActiveState: 'activating' }).active).toBe(true);
  });

  test('a failed unit is loaded, not active, and failed', () => {
    expect(
      unitStatusFrom({ LoadState: 'loaded', ActiveState: 'failed', ExecMainStatus: '1' }),
    ).toEqual({ loaded: true, active: false, failed: true, exitCode: 1 });
  });

  test('a unit systemd has never heard of is neither loaded nor active', () => {
    expect(unitStatusFrom({ LoadState: 'not-found', ActiveState: 'inactive' })).toEqual({
      loaded: false,
      active: false,
      failed: false,
    });
  });

  test('a missing exit code is absent rather than zero', () => {
    expect(unitStatusFrom({ LoadState: 'loaded', ActiveState: 'active' }).exitCode).toBeUndefined();
  });
});
