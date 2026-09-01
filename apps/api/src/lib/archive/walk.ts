// What a walk of an archive can come to, and the two ways one can stop being followable. Held
// apart from the formats themselves because a zip and a tarball reach the same ends by different
// roads, and whoever asked for the executable inside one does not care which road it was.

/** Not a container this reads, handed back with the bytes that were read to tell. */
export type Unwrapping =
  | { outcome: 'not-an-archive'; body: ReadableStream<Uint8Array> }
  | { outcome: 'unwrapped'; name: string; body: ReadableStream<Uint8Array> }
  | { outcome: 'no-executable' }
  | { outcome: 'walked-too-far' }
  | { outcome: 'entry-too-large' }
  | { outcome: 'expands-too-far' }
  | { outcome: 'unreadable' };

/**
 * How many entries a walk will read the headers of.
 *
 * An entry that declares no data costs nothing against `maxSkippedBytes`, so an archive that is
 * headers the whole way down is bounded only by how many of them fit inside the cap on the fetch.
 * Each one pays for a header, a peek and the streams to read it through — tens of microseconds —
 * so it is the count that bounds the work rather than the bytes.
 *
 * A release archive is a binary and a couple of text files. One with hundreds of files in front of
 * the binary is shipping what a deploy does nothing with, and is answered rather than walked.
 */
export const MAX_ENTRIES = 512;

/**
 * How much more a compressed source may turn out to hold than it took to send.
 *
 * The cap on a fetch is on what the url sent, and what an archive expands to is decided after it.
 * So the two are not the same bound at all: a quarter of a gibibyte of zeros is a 255 KB download,
 * and reading it costs this end the whole of that quarter to decompress, hash and write to the
 * store before the size it came to refuses it.
 *
 * A hundred is far above anything published: measured over real binaries and the archives they
 * ship in, a release expands by two or three — `bun` by 2.5, a kernel by 2.7 — and the most
 * compressible thing anyone actually ships, a binary carrying embedded text, reaches fifteen.
 * A file of zeros reaches a thousand.
 */
export const MAX_EXPANSION = 100;

/**
 * How far a source is read before that ratio is asked about at all.
 *
 * Below this the ratio says nothing: a tarball of one small file is mostly the padding tar rounds
 * every entry up to, and expands by twenty. It is also not worth asking — what an archive this
 * side of the floor can cost is the floor.
 */
export const EXPANSION_FLOOR_BYTES = 8_388_608;

/**
 * What an archive this cannot follow is raised as, wherever it stops being followable — a walk is
 * also what feeds the executable onward, so one that goes wrong after the entry was found goes
 * wrong inside a stream somebody else is already reading.
 *
 * Everything an archive can do to this end arrives as this one error, a source that stopped part
 * way included: from here they are the same event, an archive that ended before it said it would.
 */
export class UnreadableArchiveError extends Error {
  constructor() {
    super('The archive ended before the entry it was describing.');
    this.name = 'UnreadableArchiveError';
  }
}

/**
 * What an entry too long for its own header to say so is raised as.
 *
 * Both formats have a field too narrow for the lengths they may carry, and both answer it by
 * writing a marker and putting the real number somewhere this does not read. The lengths that need
 * one start past four gibibytes, which is past what could be stored — and an entry whose length is
 * unknown is one there is no way to walk past to reach whatever follows it.
 */
export class EntryTooLargeError extends Error {
  constructor() {
    super('An entry declares a length its own header could not hold.');
    this.name = 'EntryTooLargeError';
  }
}

/**
 * What a source holding far more than it took to send is raised as.
 *
 * Refused rather than read to the end and refused there: the length that would stop it is the one
 * on the artifact, and reaching that means having already done the decompressing, the hashing and
 * the writing that the bytes were sent to buy.
 */
export class ExpandsTooFarError extends Error {
  constructor() {
    super(`A compressed source holds more than ${MAX_EXPANSION} times what it took to send.`);
    this.name = 'ExpandsTooFarError';
  }
}
