// A declared content type is whatever the uploader typed, so the only honest check is the
// bytes themselves — and the first four settle it.
const ELF_MAGIC = Uint8Array.from('\x7fELF', (character) => character.charCodeAt(0));

export const ELF_MAGIC_LENGTH = ELF_MAGIC.length;

/**
 * Whether the upload is a Linux executable at all.
 *
 * The guest's init execs this binary, so anything else is a deploy that reaches a host and
 * never converges. Refusing it here costs the uploader a request instead of a deployment.
 */
export function isElfExecutable(bytes: Uint8Array): boolean {
  for (const [index, byte] of ELF_MAGIC.entries()) {
    if (bytes[index] !== byte) {
      return false;
    }
  }
  return true;
}

const ELF_CLASS_AT = 4;
const ELF_CLASS_64 = 2;
const ELF_ENDIANNESS_AT = 5;
const ELF_LITTLE_ENDIAN = 1;
const ELF_HEADER_BYTES = 0x40;
const MACHINE_AT = 0x12;
const SEGMENT_TABLE_START_AT = 0x20;
const SEGMENT_ENTRY_BYTES_AT = 0x36;
const SEGMENT_COUNT_AT = 0x38;
/** A 64-bit program header, which is the shortest entry the reads below stay inside. */
const SEGMENT_ENTRY_MIN_BYTES = 56;
const SEGMENT_TYPE_INTERPRETER = 3;
const SEGMENT_START_AT = 8;
const SEGMENT_BYTES_AT = 32;
const LITTLE_ENDIAN = true;

const NUL = '\0';

/**
 * The header, once it is all here and in the one shape the reads below assume. `undefined` is
 * "this prefix does not say", which is what every caller may reject on the absence of.
 */
function headerOf(bytes: Uint8Array): DataView | undefined {
  if (
    bytes.length < ELF_HEADER_BYTES ||
    bytes[ELF_CLASS_AT] !== ELF_CLASS_64 ||
    bytes[ELF_ENDIANNESS_AT] !== ELF_LITTLE_ENDIAN
  ) {
    return undefined;
  }
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * The instruction set this binary was built for, if the prefix given holds the header naming it.
 *
 * Unlike the loader below, this is at a fixed offset of every ELF header — so `undefined` here
 * means the prefix is too short or too foreign to be read as one at all, never that a binary
 * declined to say.
 */
export function machineOf(bytes: Uint8Array): number | undefined {
  return headerOf(bytes)?.getUint16(MACHINE_AT, LITTLE_ENDIAN);
}

/**
 * The dynamic loader this binary names, if the prefix given holds it.
 *
 * `undefined` is "this prefix does not say" and never "there is none": a static binary, an ELF
 * this cannot parse, and an interpreter sitting past the prefix are all indistinguishable here,
 * so the caller may only ever reject on a path it actually read.
 */
export function interpreterOf(bytes: Uint8Array): string | undefined {
  const view = headerOf(bytes);
  if (view === undefined) {
    return undefined;
  }
  const tableStart = Number(view.getBigUint64(SEGMENT_TABLE_START_AT, LITTLE_ENDIAN));
  const entryBytes = view.getUint16(SEGMENT_ENTRY_BYTES_AT, LITTLE_ENDIAN);
  const entryCount = view.getUint16(SEGMENT_COUNT_AT, LITTLE_ENDIAN);
  if (entryBytes < SEGMENT_ENTRY_MIN_BYTES) {
    return undefined;
  }
  for (let index = 0; index < entryCount; index++) {
    const entry = tableStart + index * entryBytes;
    if (entry + entryBytes > bytes.length) {
      return undefined;
    }
    if (view.getUint32(entry, LITTLE_ENDIAN) !== SEGMENT_TYPE_INTERPRETER) {
      continue;
    }
    const start = Number(view.getBigUint64(entry + SEGMENT_START_AT, LITTLE_ENDIAN));
    const length = Number(view.getBigUint64(entry + SEGMENT_BYTES_AT, LITTLE_ENDIAN));
    if (start + length > bytes.length) {
      return undefined;
    }
    const [path] = new TextDecoder().decode(bytes.subarray(start, start + length)).split(NUL);
    return path;
  }
  return undefined;
}

/**
 * The paths the guest rootfs actually resolves, from `infra/guest-image/rootfs/build-rootfs.sh`
 * — which installs glibc's loader and symlinks `/lib` and `/lib64` at it. Nothing compares the
 * two, so a change to that image's layout is also a change here.
 */
const GUEST_INTERPRETERS = [
  '/lib64/ld-linux-x86-64.so.2',
  '/usr/lib64/ld-linux-x86-64.so.2',
  '/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2',
  '/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2',
];

/**
 * Whether the guest could open this loader.
 *
 * A binary built against a store-addressed toolchain (Nix) or a different libc (musl) names a
 * path nothing in the image provides, and `execve` reports that as `ENOENT` against the binary
 * rather than against the loader — so a deploy that reaches a host fails saying the file it did
 * find is not there.
 */
export function isGuestInterpreter(interpreter: string): boolean {
  return GUEST_INTERPRETERS.includes(interpreter);
}

/**
 * `EM_X86_64`. App hosts are x86_64 and Firecracker emulates nothing else, so a binary built for
 * any other machine is one no host in the fleet could ever exec.
 */
const GUEST_MACHINE = 62;

export function isGuestMachine(machine: number): boolean {
  return machine === GUEST_MACHINE;
}

/** `EM_AARCH64`, which is what an Apple Silicon laptop or an arm64 CI runner builds by default. */
const ARM64_MACHINE = 183;

/**
 * The machine in the spelling whoever built the binary would recognise — a cross-compile target
 * rather than the ELF constant's own name. Only the one worth naming: anything else here was
 * cross-compiled on purpose, and its number is enough to look up.
 */
export function describeMachine(machine: number): string {
  return machine === ARM64_MACHINE ? 'arm64' : `ELF machine ${machine}`;
}
