import { describe, expect, test } from 'bun:test';
import { MAX_IMPORT_SIZE_BYTES, refusedArchive } from '#archive.ts';

const BLOCK_BYTES = 512;
const TAR_MAGIC_AT = 257;
const NAME = 'data.tar.gz';

const encoder = new TextEncoder();

/** A tar's first header, which is the only part of one that says a stream of bytes is a tar. */
function tarball(): Uint8Array<ArrayBuffer> {
  const block = new Uint8Array(BLOCK_BYTES);
  block.set(encoder.encode('data.db'));
  block.set(encoder.encode('ustar'), TAR_MAGIC_AT);
  return block;
}

function offered({ name = NAME, bytes }: { name?: string; bytes: Uint8Array }) {
  return { name, body: new Blob([new Uint8Array(bytes)]) };
}

/**
 * An archive that says it is a given size while holding only its opening: a gibibyte held in memory
 * to be refused for being a gibibyte is the one thing this check exists to spare anybody.
 */
function claiming(sizeBytes: number) {
  const { body } = offered({ bytes: Bun.gzipSync(tarball()) });
  return { name: NAME, body: { size: sizeBytes, stream: body.stream.bind(body) } as Blob };
}

describe('an archive an app can be created from', () => {
  test('a gzipped tarball is what one is', async () => {
    expect(await refusedArchive(offered({ bytes: Bun.gzipSync(tarball()) }))).toBeUndefined();
  });

  test('a zip is named as the shape it is not, rather than as what was found', async () => {
    const zip = encoder.encode('PK and the rest of an ordinary zip');

    expect(await refusedArchive(offered({ bytes: zip }))).toContain('is not a .tar.gz');
  });

  // `gzip data.db` opens exactly as `tar czf` does, and only the bytes inside tell them apart.
  test('a gzip wrapped around anything else is refused for what it holds', async () => {
    const gzipped = Bun.gzipSync(encoder.encode('SQLite format 3'));

    expect(await refusedArchive(offered({ bytes: gzipped }))).toContain('is not a .tar.gz');
  });

  test('nothing at all is refused as nothing to give the app', async () => {
    expect(await refusedArchive(offered({ bytes: new Uint8Array() }))).toBe(
      'There is nothing in data.tar.gz to give the app as its data.',
    );
  });

  test('more than the api would sign for is refused before a byte of it is read', async () => {
    expect(await refusedArchive(claiming(MAX_IMPORT_SIZE_BYTES + 1))).toContain(
      'at most 1 GiB of data',
    );
  });

  test('the size the api signs for is not itself too much', async () => {
    expect(await refusedArchive(claiming(MAX_IMPORT_SIZE_BYTES))).toBeUndefined();
  });

  test('a name the api would refuse costs a line rather than the upload before it', async () => {
    const named = { ...offered({ bytes: Bun.gzipSync(tarball()) }), name: 'my data.tar.gz' };

    expect(await refusedArchive(named)).toContain('is not a name nibrun takes');
  });
});
