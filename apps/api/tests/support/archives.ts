import { Buffer } from 'node:buffer';
import { deflateRawSync } from 'node:zlib';

/** An entry as a release archive carries one, and the ways a writer can have written it. */
export type ArchiveEntry = {
  name: string;
  content: Uint8Array;
  /** As every writer that streams its output leaves them, which is how a release is built. */
  sizesInDescriptor?: boolean;
  stored?: boolean;
  /** The shape of that descriptor: the format leaves both of these to the writer. */
  descriptor?: DescriptorShape;
  /** Where its lengths are, where the header's own four-byte fields could not hold them. */
  zip64Sizes?: Zip64Sizes;
};

/** Signed as writers conventionally do, and four bytes wide unless the entry declared zip64. */
type DescriptorShape = { signed?: boolean; zip64?: boolean };

/** Beside the header as the format says, or nowhere at all, which is a header pointing at nothing. */
type Zip64Sizes = 'in-the-extra-field' | 'said-nowhere';

export const LOCAL_HEADER_BYTES = 30;

const CENTRAL_HEADER_BYTES = 46;
const END_OF_DIRECTORY_BYTES = 22;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_DIRECTORY_SIGNATURE = 0x06054b50;
const SIGNATURE_BYTES = 4;
const CRC_BYTES = 4;
const SIZE_BYTES = 4;
const ZIP64_SIZE_BYTES = 8;
const FLAG_SIZES_IN_DESCRIPTOR = 0x08;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAGS_AT = 6;
const METHOD_AT = 8;
const COMPRESSED_SIZE_AT = 18;
const UNCOMPRESSED_SIZE_AT = 22;
const NAME_LENGTH_AT = 26;
const EXTRA_LENGTH_AT = 28;
const SIZE_IN_ZIP64_EXTRA = 0xff_ff_ff_ff;
const ZIP64_EXTRA_ID = 0x0001;
const EXTRA_HEADER_BYTES = 4;
const ZIP64_SIZES_BYTES = 16;
const EMPTY = new Uint8Array(0);

/**
 * A zip as far as this end reads one: entries, each preceded by its header, and a directory at the
 * end that is only ever recognised by the signature it opens with. The crc fields are left at zero
 * — a walk verifies an entry's length against where its descriptor sits, and nothing reads
 * anything else the directory or the descriptor has to say.
 */
export function archiveOf(entries: ArchiveEntry[]): Uint8Array {
  const written: Uint8Array[] = [];

  for (const entry of entries) {
    const data = entry.stored === true ? entry.content : deflateRawSync(entry.content);
    const trailed = entry.sizesInDescriptor !== false;
    const extra = extraOf({ entry, data });
    written.push(headerOf({ entry, data, trailed, extra }), bytesOf(entry.name), extra, data);
    if (trailed) {
      written.push(descriptorOf({ entry, compressedSizeBytes: data.byteLength }));
    }
  }

  written.push(...entries.map(directoryRecord), endOfDirectory());

  return Buffer.concat(written);
}

function headerOf({
  entry,
  data,
  trailed,
  extra,
}: {
  entry: ArchiveEntry;
  data: Uint8Array;
  trailed: boolean;
  extra: Uint8Array;
}): Uint8Array {
  const header = Buffer.alloc(LOCAL_HEADER_BYTES);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(trailed ? FLAG_SIZES_IN_DESCRIPTOR : 0, FLAGS_AT);
  header.writeUInt16LE(entry.stored === true ? METHOD_STORED : METHOD_DEFLATE, METHOD_AT);
  header.writeUInt32LE(
    declaredBy({ entry, trailed, sizeBytes: data.byteLength }),
    COMPRESSED_SIZE_AT,
  );
  header.writeUInt32LE(
    declaredBy({ entry, trailed, sizeBytes: entry.content.byteLength }),
    UNCOMPRESSED_SIZE_AT,
  );
  header.writeUInt16LE(Buffer.byteLength(entry.name, 'utf8'), NAME_LENGTH_AT);
  header.writeUInt16LE(extra.byteLength, EXTRA_LENGTH_AT);
  return header;
}

/** The field a zip64 writer puts the real lengths in, uncompressed first as a local header must. */
function extraOf({ entry, data }: { entry: ArchiveEntry; data: Uint8Array }): Uint8Array {
  if (entry.zip64Sizes !== 'in-the-extra-field') {
    return EMPTY;
  }
  const extra = Buffer.alloc(EXTRA_HEADER_BYTES + ZIP64_SIZES_BYTES);
  extra.writeUInt16LE(ZIP64_EXTRA_ID, 0);
  extra.writeUInt16LE(ZIP64_SIZES_BYTES, 2);
  extra.writeBigUInt64LE(BigInt(entry.content.byteLength), EXTRA_HEADER_BYTES);
  extra.writeBigUInt64LE(BigInt(data.byteLength), EXTRA_HEADER_BYTES + ZIP64_SIZE_BYTES);
  return extra;
}

/** What the header says a length is: nothing where the descriptor will say it, and all ones where
 *  only a zip64 field could hold it. */
function declaredBy({
  entry,
  trailed,
  sizeBytes,
}: {
  entry: ArchiveEntry;
  trailed: boolean;
  sizeBytes: number;
}): number {
  if (entry.zip64Sizes !== undefined) {
    return SIZE_IN_ZIP64_EXTRA;
  }
  return trailed ? 0 : sizeBytes;
}

function descriptorOf({
  entry,
  compressedSizeBytes,
}: {
  entry: ArchiveEntry;
  compressedSizeBytes: number;
}): Uint8Array {
  const signed = entry.descriptor?.signed !== false;
  const zip64 = entry.descriptor?.zip64 === true;
  const sizeBytes = zip64 ? ZIP64_SIZE_BYTES : SIZE_BYTES;
  const signatureBytes = signed ? SIGNATURE_BYTES : 0;
  const descriptor = Buffer.alloc(signatureBytes + CRC_BYTES + 2 * sizeBytes);

  if (signed) {
    descriptor.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0);
  }
  const compressedSizeAt = signatureBytes + CRC_BYTES;
  if (zip64) {
    descriptor.writeBigUInt64LE(BigInt(compressedSizeBytes), compressedSizeAt);
  } else {
    descriptor.writeUInt32LE(compressedSizeBytes, compressedSizeAt);
  }

  return descriptor;
}

function directoryRecord(): Uint8Array {
  const record = Buffer.alloc(CENTRAL_HEADER_BYTES);
  record.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
  return record;
}

function endOfDirectory(): Uint8Array {
  const end = Buffer.alloc(END_OF_DIRECTORY_BYTES);
  end.writeUInt32LE(END_OF_DIRECTORY_SIGNATURE, 0);
  return end;
}

function bytesOf(text: string): Uint8Array {
  return Buffer.from(text, 'utf8');
}
