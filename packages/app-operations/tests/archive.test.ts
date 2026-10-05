import { describe, expect, test } from 'bun:test';
import { MAX_IMPORT_SIZE_BYTES, refusedArchiveBody } from '#archive.ts';
import { gzippedTarball, zip } from '#tests/support/archives.ts';

const NAME = 'data.tar.gz';

const encoder = new TextEncoder();

function offered({ name = NAME, bytes }: { name?: string; bytes: Uint8Array }) {
  return { name, body: new Blob([new Uint8Array(bytes)]) };
}

/**
 * An archive that says it is a given size while holding only its opening: a gibibyte held in memory
 * to be refused for being a gibibyte is the one thing this check exists to spare anybody.
 */
function claiming(sizeBytes: number) {
  const { body } = offered({ bytes: gzippedTarball() });
  return { name: NAME, body: { size: sizeBytes, stream: body.stream.bind(body) } as Blob };
}

describe('an archive an app can be created from', () => {
  test('a gzipped tarball is what one is', async () => {
    expect(await refusedArchiveBody(offered({ bytes: gzippedTarball() }))).toBeUndefined();
  });

  test('and so is a zip, which is what a desktop archiver makes', async () => {
    expect(await refusedArchiveBody(offered({ name: 'data.zip', bytes: zip() }))).toBeUndefined();
  });

  /**
   * A zip says what it is in the index at its *end*, which is past the gibibyte this exists not
   * to read. So the first record has to hold together: a magic on its own is four bytes that
   * anything at all can open with.
   */
  test('bytes that only open like a zip are refused as the shape they are not', async () => {
    const opening = encoder.encode('PK and the rest of an ordinary zip');

    expect(await refusedArchiveBody(offered({ bytes: opening }))).toContain(
      'is not a .tar.gz or a .zip',
    );
  });

  // `gzip data.db` opens exactly as `tar czf` does, and only the bytes inside tell them apart.
  test('a gzip wrapped around anything else is refused for what it holds', async () => {
    const gzipped = Bun.gzipSync(encoder.encode('SQLite format 3'));

    expect(await refusedArchiveBody(offered({ bytes: gzipped }))).toContain(
      'is not a .tar.gz or a .zip',
    );
  });

  test('nothing at all is refused as nothing to give the app', async () => {
    expect(await refusedArchiveBody(offered({ bytes: new Uint8Array() }))).toBe(
      'There is nothing in data.tar.gz to give the app as its data.',
    );
  });

  test('more than the api would sign for is refused before a byte of it is read', async () => {
    expect(await refusedArchiveBody(claiming(MAX_IMPORT_SIZE_BYTES + 1))).toContain(
      'at most 1 GiB of data',
    );
  });

  test('the size the api signs for is not itself too much', async () => {
    expect(await refusedArchiveBody(claiming(MAX_IMPORT_SIZE_BYTES))).toBeUndefined();
  });

  test('content preflight leaves filename policy to the API', async () => {
    const named = { ...offered({ bytes: gzippedTarball() }), name: 'my data.tar.gz' };

    expect(await refusedArchiveBody(named)).toBeUndefined();
  });
});
