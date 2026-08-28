import { Buffer } from 'node:buffer';
import { deflateRawSync } from 'node:zlib';

/** An entry as a release archive carries one, and the two ways a writer can have written it. */
export type ArchiveEntry = {
  name: string;
  content: Uint8Array;
  /** As every writer that streams its output leaves them, which is how a release is built. */
  sizesInDescriptor?: boolean;
  stored?: boolean;
};

export const LOCAL_HEADER_BYTES = 30;

const CENTRAL_HEADER_BYTES = 46;
const END_OF_DIRECTORY_BYTES = 22;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const DESCRIPTOR_SIGNATURE = 0x08074b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_DIRECTORY_SIGNATURE = 0x06054b50;
const DESCRIPTOR_BYTES = 16;
const DESCRIPTOR_COMPRESSED_SIZE_AT = 8;
const FLAG_SIZES_IN_DESCRIPTOR = 0x08;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAGS_AT = 6;
const METHOD_AT = 8;
const COMPRESSED_SIZE_AT = 18;
const UNCOMPRESSED_SIZE_AT = 22;
const NAME_LENGTH_AT = 26;

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
    written.push(headerOf({ entry, data, trailed }), bytesOf(entry.name), data);
    if (trailed) {
      written.push(descriptorOf(data.byteLength));
    }
  }

  written.push(...entries.map(directoryRecord), endOfDirectory());

  return Buffer.concat(written);
}

function headerOf({
  entry,
  data,
  trailed,
}: {
  entry: ArchiveEntry;
  data: Uint8Array;
  trailed: boolean;
}): Uint8Array {
  const header = Buffer.alloc(LOCAL_HEADER_BYTES);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(trailed ? FLAG_SIZES_IN_DESCRIPTOR : 0, FLAGS_AT);
  header.writeUInt16LE(entry.stored === true ? METHOD_STORED : METHOD_DEFLATE, METHOD_AT);
  header.writeUInt32LE(trailed ? 0 : data.byteLength, COMPRESSED_SIZE_AT);
  header.writeUInt32LE(trailed ? 0 : entry.content.byteLength, UNCOMPRESSED_SIZE_AT);
  header.writeUInt16LE(entry.name.length, NAME_LENGTH_AT);
  return header;
}

function descriptorOf(compressedSizeBytes: number): Uint8Array {
  const descriptor = Buffer.alloc(DESCRIPTOR_BYTES);
  descriptor.writeUInt32LE(DESCRIPTOR_SIGNATURE, 0);
  descriptor.writeUInt32LE(compressedSizeBytes, DESCRIPTOR_COMPRESSED_SIZE_AT);
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
