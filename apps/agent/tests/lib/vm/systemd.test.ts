import { describe, expect, test } from 'bun:test';
import { AppIdSchema, Value } from '@repo/protocol';
import { appIdFromUnit, parseUnitNames, vmUnitName } from '#lib/vm/systemd.ts';
import { parseProperties, parsePropertyBlocks, unitStatusFrom } from '#lib/vm/unit-status.ts';

describe('unit naming round-trips', () => {
  test('an instance id becomes a template instance and back', () => {
    const appId = Value.Parse(AppIdSchema, 'inst-A_1');
    expect(vmUnitName(appId)).toBe('nibrun-vm@inst-A_1.service');
    expect(appIdFromUnit(vmUnitName(appId))).toBe(appId);
  });

  test('a unit that is not ours is ignored', () => {
    expect(appIdFromUnit('sshd.service')).toBeUndefined();
    expect(appIdFromUnit('nibrun-vm@inst-1.socket')).toBeUndefined();
  });

  test('an instance name that is not a valid identifier is refused', () => {
    expect(appIdFromUnit('nibrun-vm@..\\x2fetc.service')).toBeUndefined();
    expect(appIdFromUnit('nibrun-vm@.service')).toBeUndefined();
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
      unitStatusFrom({
        LoadState: 'loaded',
        ActiveState: 'failed',
        ExecMainStatus: '1',
        InactiveExitTimestampMonotonic: '6648500594',
      }),
    ).toEqual({
      loaded: true,
      active: false,
      failed: true,
      startedThisBoot: true,
      exitCode: 1,
    });
  });

  test('a unit systemd has never heard of is neither loaded nor active', () => {
    expect(unitStatusFrom({ LoadState: 'not-found', ActiveState: 'inactive' })).toEqual({
      loaded: false,
      active: false,
      failed: false,
      startedThisBoot: false,
    });
  });

  // systemd answers `inactive` both for a VM that ran and stopped and for one that has not
  // existed since the host booted. Only the monotonic clock separates them, and reading the
  // second as the first is what would leave every VM down after a reboot.
  test('a unit that has not run since boot is told apart from one that ran and stopped', () => {
    const neverRan = unitStatusFrom({
      LoadState: 'loaded',
      ActiveState: 'inactive',
      SubState: 'dead',
      InactiveExitTimestampMonotonic: '0',
    });
    const ranAndStopped = unitStatusFrom({
      LoadState: 'loaded',
      ActiveState: 'inactive',
      SubState: 'dead',
      InactiveExitTimestampMonotonic: '6648500594',
    });

    expect(neverRan.active).toBe(ranAndStopped.active);
    expect(neverRan.startedThisBoot).toBe(false);
    expect(ranAndStopped.startedThisBoot).toBe(true);
  });

  test('a unit systemd reports no start timestamp for has not run this boot', () => {
    expect(unitStatusFrom({ LoadState: 'loaded', ActiveState: 'inactive' }).startedThisBoot).toBe(
      false,
    );
  });

  test('a missing exit code is absent rather than zero', () => {
    expect(unitStatusFrom({ LoadState: 'loaded', ActiveState: 'active' }).exitCode).toBeUndefined();
  });
});
