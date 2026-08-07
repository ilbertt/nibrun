import { describe, expect, test } from 'bun:test';
import type { AppId, VolumeId } from '@repo/protocol';
import { volumeOwners } from '#lib/reconcile/volumes.ts';
import type { InstanceRecord } from '#lib/report/instance-record.ts';
import { APP_ID, desiredState, desiredVolume, VOLUME_ID } from '#tests/support/fixtures.ts';

/** Only the two fields an owner is read out of; the rest of a record is not what this decides. */
function record(): InstanceRecord {
  return { appId: APP_ID, volumeId: VOLUME_ID } as InstanceRecord;
}

function records(all: readonly InstanceRecord[]): ReadonlyMap<AppId, InstanceRecord> {
  return new Map(all.map((one) => [one.appId, one]));
}

function owners(map: ReadonlyMap<VolumeId, AppId>): Array<[VolumeId, AppId]> {
  return [...map.entries()];
}

describe('a volume belongs to the app the control plane says it belongs to', () => {
  test('a record this agent holds names its volume', () => {
    const map = volumeOwners({ desired: desiredState(), records: records([record()]) });

    expect(owners(map)).toEqual([[VOLUME_ID, APP_ID]]);
  });

  /**
   * The case that kept a deleted tenant's filesystem forever. The control plane stops naming the
   * instance a pass before the volume teardown is unblocked, so the record is dropped first — and
   * a volume nothing claims is observed as an orphan and left alone, which un-plans the teardown
   * that was about to run.
   */
  test('a volume still desired is claimed even once the instance is forgotten', () => {
    const map = volumeOwners({
      desired: desiredState({ volumes: [desiredVolume({ desiredState: 'absent' })] }),
      records: records([]),
    });

    expect(owners(map)).toEqual([[VOLUME_ID, APP_ID]]);
  });

  test('a volume neither named nor recorded is nobody to guess at', () => {
    const map = volumeOwners({ desired: desiredState(), records: records([]) });

    expect(owners(map)).toEqual([]);
  });
});
