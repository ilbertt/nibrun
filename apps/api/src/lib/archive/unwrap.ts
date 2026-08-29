// What a url answered with, as the binary it holds. A release is published as a bare executable, as
// a zip, or as a tarball — and for Linux far more often as the last of the three than the second —
// so what a fetch has in hand is decided by the bytes rather than by what the link was called.

import { Buffer } from 'node:buffer';
import { createGunzip } from 'node:zlib';
import { decompressed, type Queued, queued, streamed } from '#lib/archive/bytes.ts';
import { executableInTarball, isTarball, TAR_IDENTITY_BYTES } from '#lib/archive/tar.ts';
import { EntryTooLargeError, UnreadableArchiveError, type Unwrapping } from '#lib/archive/walk.ts';
import { executableInZip, ZIP_MAGIC } from '#lib/archive/zip.ts';

/** What a gzip opens with, whatever it turns out to be wrapped around. */
const GZIP_MAGIC = Buffer.from('\x1f\x8b', 'latin1');

/** Enough to tell the two containers apart that say what they are in their first bytes. */
const OPENING_BYTES = Math.max(ZIP_MAGIC.length, GZIP_MAGIC.length);

/**
 * The executable inside whatever the url answered with, or the bytes back where they are already
 * one. A project that publishes its build in an archive is publishing a url nobody could deploy
 * from otherwise — the alternative is downloading it, unpacking it, and uploading the one file.
 *
 * `maxSkippedBytes` bounds the walk. An archive is a claim about its own contents, and an entry
 * claiming a petabyte of text before the binary would otherwise be read until it ended.
 */
export async function unwrapExecutable({
  archive,
  maxSkippedBytes,
}: {
  archive: ReadableStream<Uint8Array>;
  maxSkippedBytes: number;
}): Promise<Unwrapping> {
  const bytes = queued(archive);
  const opening = await bytes.need(OPENING_BYTES);

  if (opening?.equals(ZIP_MAGIC)) {
    return await walked({ bytes, walk: () => executableInZip({ bytes, maxSkippedBytes }) });
  }
  if (opening?.subarray(0, GZIP_MAGIC.length).equals(GZIP_MAGIC)) {
    return await walked({ bytes, walk: () => gunzipped({ bytes, maxSkippedBytes }) });
  }
  // A tar says what it is a quarter of a kibibyte in, so it is asked for last and asked for
  // separately: a zip small enough to end before that is still a zip.
  const header = await bytes.need(TAR_IDENTITY_BYTES);
  if (header !== undefined && isTarball(header)) {
    return await walked({ bytes, walk: () => executableInTarball({ bytes, maxSkippedBytes }) });
  }
  return { outcome: 'not-an-archive', body: bytes.rest() };
}

/**
 * What a gzip holds: the executable inside the tarball it turns out to be, or the executable it is
 * itself. Releases are published both ways — `my-server_linux_amd64.tar.gz` beside a bare
 * `my-server.gz` — and both are one gunzip away from the same question.
 *
 * What is not a tarball is handed on rather than refused. Whether those bytes are an executable is
 * a question the inspection asks of everything, and asking it twice would only answer it worse.
 */
async function gunzipped({
  bytes,
  maxSkippedBytes,
}: {
  bytes: Queued;
  maxSkippedBytes: number;
}): Promise<Unwrapping> {
  const content = queued(streamed(decompressed({ engine: createGunzip(), data: bytes.rest() })));
  const opening = await content.need(TAR_IDENTITY_BYTES);
  if (opening === undefined || !isTarball(opening)) {
    return { outcome: 'not-an-archive', body: content.rest() };
  }
  return await executableInTarball({ bytes: content, maxSkippedBytes });
}

/**
 * The walk, with the source let go of whatever it failed on. A walk is also what feeds the
 * executable onward, so one that goes wrong is one nobody downstream is going to finish reading.
 */
async function walked({
  bytes,
  walk,
}: {
  bytes: Queued;
  walk: () => Promise<Unwrapping>;
}): Promise<Unwrapping> {
  try {
    return await walk();
  } catch (failure) {
    await bytes.cancel();
    if (failure instanceof UnreadableArchiveError) {
      return { outcome: 'unreadable' };
    }
    if (failure instanceof EntryTooLargeError) {
      return { outcome: 'entry-too-large' };
    }
    throw failure;
  }
}
