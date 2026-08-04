import { describe, expect, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { Either } from 'effect';
import { type DecodedFrames, decodeFrames, EMPTY_BUFFER } from '#lib/logs/guest-protocol.ts';
import { gapFrame, guestLogFrame, PAYLOAD_LENGTH_OFFSET } from '#tests/support/guest-frames.ts';

const TRANSPORT_SPLIT_AT = 7;
const DROPPED_BYTES = 42n;
const OVERSIZED_PAYLOAD_BYTES = 1_048_576;

function decoded(result: Either.Either<DecodedFrames, unknown>) {
  return Either.getOrThrow(result as Either.Either<DecodedFrames, Error>);
}

describe('guest log frames', () => {
  test('arbitrary transport chunks preserve stdout and stderr boundaries', () => {
    const bytes = Buffer.concat([
      guestLogFrame({ kind: 'stdout', payload: Buffer.from('one\n') }),
      guestLogFrame({ kind: 'stderr', payload: Buffer.from('two\n') }),
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
    expect(
      decoded(decodeFrames({ buffered: EMPTY_BUFFER, chunk: gapFrame(DROPPED_BYTES) })).frames,
    ).toEqual([{ kind: 'gap', droppedBytes: Number(DROPPED_BYTES) }]);
  });

  test('an invalid peer cannot make the parser allocate an unbounded payload', () => {
    const frame = guestLogFrame({ kind: 'stdout', payload: Buffer.from('text') });
    frame.writeUInt32BE(OVERSIZED_PAYLOAD_BYTES, PAYLOAD_LENGTH_OFFSET);

    const result = decodeFrames({ buffered: EMPTY_BUFFER, chunk: frame });
    expect(Either.isLeft(result) && result.left._tag).toBe('InvalidGuestLogFrame');
  });
});
