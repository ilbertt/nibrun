import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { Either } from 'effect';
import {
  type DecodedFrames,
  decodeFrames,
  EMPTY_BUFFER,
  encodeGuestLogFrameForTest,
} from '#logs/guest-protocol.ts';

const TRANSPORT_SPLIT_AT = 7;
const GAP_PAYLOAD_BYTES = 8;
const DROPPED_BYTES = 42n;
const OVERSIZED_PAYLOAD_BYTES = 1_048_576;
const PAYLOAD_LENGTH_OFFSET = 5;

const decoded = (result: Either.Either<DecodedFrames, unknown>) =>
  Either.getOrThrow(result as Either.Either<DecodedFrames, Error>);

describe('guest log frames', () => {
  test('arbitrary transport chunks preserve stdout and stderr boundaries', () => {
    const bytes = Buffer.concat([
      encodeGuestLogFrameForTest({ kind: 'stdout', payload: Buffer.from('one\n') }),
      encodeGuestLogFrameForTest({ kind: 'stderr', payload: Buffer.from('two\n') }),
    ]);

    const first = decoded(
      decodeFrames({ buffered: EMPTY_BUFFER, chunk: bytes.subarray(0, TRANSPORT_SPLIT_AT) }),
    );
    expect(first.frames).toEqual([]);

    const second = decoded(
      decodeFrames({ buffered: first.rest, chunk: bytes.subarray(TRANSPORT_SPLIT_AT) }),
    );
    expect(second.frames).toEqual([
      { kind: 'data', stream: 'stdout', bytes: Buffer.from('one\n') },
      { kind: 'data', stream: 'stderr', bytes: Buffer.from('two\n') },
    ]);
  });

  test('a gap carries the byte count the guest could not deliver', () => {
    const payload = Buffer.alloc(GAP_PAYLOAD_BYTES);
    payload.writeBigUInt64BE(DROPPED_BYTES);

    expect(
      decoded(
        decodeFrames({
          buffered: EMPTY_BUFFER,
          chunk: encodeGuestLogFrameForTest({ kind: 'gap', payload }),
        }),
      ).frames,
    ).toEqual([{ kind: 'gap', droppedBytes: 42 }]);
  });

  test('an invalid peer cannot make the parser allocate an unbounded payload', () => {
    const frame = Buffer.from(
      encodeGuestLogFrameForTest({ kind: 'stdout', payload: Buffer.from('text') }),
    );
    frame.writeUInt32BE(OVERSIZED_PAYLOAD_BYTES, PAYLOAD_LENGTH_OFFSET);

    const result = decodeFrames({ buffered: EMPTY_BUFFER, chunk: frame });
    expect(Either.isLeft(result) && result.left._tag).toBe('InvalidGuestLogFrame');
  });
});
