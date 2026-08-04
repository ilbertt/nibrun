import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import {
  encodeGuestLogFrameForTest,
  GuestLogFrameDecoder,
  InvalidGuestLogFrameError,
} from '#logs/guest-protocol.ts';

const TRANSPORT_SPLIT_AT = 7;
const GAP_PAYLOAD_BYTES = 8;
const DROPPED_BYTES = 42n;
const OVERSIZED_PAYLOAD_BYTES = 1_048_576;
const PAYLOAD_LENGTH_OFFSET = 5;

describe('guest log frames', () => {
  test('arbitrary transport chunks preserve stdout and stderr boundaries', () => {
    const stdout = encodeGuestLogFrameForTest({
      kind: 'stdout',
      payload: Buffer.from('one\n'),
    });
    const stderr = encodeGuestLogFrameForTest({
      kind: 'stderr',
      payload: Buffer.from('two\n'),
    });
    const bytes = Buffer.concat([stdout, stderr]);
    const decoder = new GuestLogFrameDecoder();

    expect(decoder.push(bytes.subarray(0, TRANSPORT_SPLIT_AT))).toEqual([]);
    expect(decoder.push(bytes.subarray(TRANSPORT_SPLIT_AT))).toEqual([
      { kind: 'data', stream: 'stdout', bytes: Buffer.from('one\n') },
      { kind: 'data', stream: 'stderr', bytes: Buffer.from('two\n') },
    ]);
  });

  test('a gap carries the byte count the guest could not deliver', () => {
    const payload = Buffer.alloc(GAP_PAYLOAD_BYTES);
    payload.writeBigUInt64BE(DROPPED_BYTES);
    const decoder = new GuestLogFrameDecoder();

    expect(decoder.push(encodeGuestLogFrameForTest({ kind: 'gap', payload }))).toEqual([
      { kind: 'gap', droppedBytes: 42 },
    ]);
  });

  test('an invalid peer cannot make the parser allocate an unbounded payload', () => {
    const frame = Buffer.from(
      encodeGuestLogFrameForTest({ kind: 'stdout', payload: Buffer.from('text') }),
    );
    frame.writeUInt32BE(OVERSIZED_PAYLOAD_BYTES, PAYLOAD_LENGTH_OFFSET);

    expect(() => new GuestLogFrameDecoder().push(frame)).toThrow(InvalidGuestLogFrameError);
  });
});
