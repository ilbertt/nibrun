import { FileSystem } from '@effect/platform';
import { type HostDesiredState, type HostId, Sha256DigestSchema } from '@repo/protocol';
import { Value } from '@sinclair/typebox/value';
import { Data, Effect } from 'effect';
import { writeTextFile } from '#lib/json-store.ts';
import type { HostDesiredState as NibrunnerDesiredState } from '#lib/nibrunner/desired.gen.ts';
import { nibrunnerDesiredState } from '#lib/nibrunner/desired-state.ts';
import type { HostReportedState as NibrunnerReport } from '#lib/nibrunner/reported.gen.ts';
import { decodeNibrunnerReport } from '#lib/nibrunner/reported-state.ts';
import { decode } from '#lib/protocol.ts';

export class MissingNibrunnerFile extends Data.TaggedError('MissingNibrunnerFile')<{
  readonly path: string;
}> {
  override get message() {
    return `The nibrunner state file at ${this.path} is missing.`;
  }
}

export class ForeignNibrunnerDocument extends Data.TaggedError('ForeignNibrunnerDocument')<{
  readonly path: string;
}> {
  override get message() {
    return `The nibrunner desired document at ${this.path} belongs to a different host.`;
  }
}

export class MalformedNibrunnerFile extends Data.TaggedError('MalformedNibrunnerFile')<{
  readonly path: string;
}> {
  override get message() {
    return `The nibrunner state file at ${this.path} is not valid JSON.`;
  }
}

function documentDigest(text: string) {
  return Value.Parse(Sha256DigestSchema, new Bun.CryptoHasher('sha256').update(text).digest('hex'));
}

export function nibrunnerDocument(desired: HostDesiredState) {
  return nibrunnerDesiredState({ desired, revision: documentDigest(JSON.stringify(desired)) });
}

const readDocument = Effect.fn('nibrunner.readDocument')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(path))) {
    return yield* new MissingNibrunnerFile({ path });
  }
  return yield* fs.readFileString(path);
});

export const readNibrunnerReport = Effect.fn('nibrunner.readReport')(function* (path: string) {
  const text = yield* readDocument(path);
  const value: NibrunnerReport = yield* Effect.try({
    try: () => JSON.parse(text),
    catch: () => new MalformedNibrunnerFile({ path }),
  });
  const report = yield* decodeNibrunnerReport(value);
  return { value, report };
});

export const writeNibrunnerDesired = Effect.fn('nibrunner.writeDesired')(function* ({
  path,
  desired,
}: {
  path: string;
  desired: HostDesiredState;
}) {
  const converted = yield* decode(() => nibrunnerDocument(desired));
  return yield* writeNibrunnerDocument({ path, desired: converted });
});

export const writeNibrunnerDocument = Effect.fn('nibrunner.writeDocument')(function* ({
  path,
  desired,
}: {
  path: string;
  desired: NibrunnerDesiredState;
}) {
  const fs = yield* FileSystem.FileSystem;
  const text = `${JSON.stringify(desired)}\n`;
  if (!(yield* fs.exists(path)) || (yield* fs.readFileString(path)) !== text) {
    yield* writeTextFile({ path, value: text });
  }
  return documentDigest(text);
});

const readOwnedDocument = Effect.fn('nibrunner.readOwnedDocument')(function* ({
  path,
  hostId,
}: {
  path: string;
  hostId: HostId;
}) {
  const text = yield* readDocument(path);
  const value: NibrunnerDesiredState = yield* Effect.try({
    try: () => JSON.parse(text),
    catch: () => new MalformedNibrunnerFile({ path }),
  });
  if (
    typeof value !== 'object' ||
    value === null ||
    !('hostId' in value) ||
    value.hostId !== hostId
  ) {
    return yield* new ForeignNibrunnerDocument({ path });
  }
  return { desired: value, digest: documentDigest(text) };
});

export const readNibrunnerDesired = Effect.fn('nibrunner.readDesired')(function* (input: {
  path: string;
  hostId: HostId;
}) {
  return (yield* readOwnedDocument(input)).desired;
});

export const readNibrunnerDesiredDigest = Effect.fn('nibrunner.readDesiredDigest')(
  function* (input: { path: string; hostId: HostId }) {
    return (yield* readOwnedDocument(input)).digest;
  },
);
