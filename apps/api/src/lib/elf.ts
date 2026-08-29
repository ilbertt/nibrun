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
const SEGMENT_TABLE_START_AT = 0x20;
const SEGMENT_ENTRY_BYTES_AT = 0x36;
const SEGMENT_COUNT_AT = 0x38;
/** A 64-bit program header, which is the shortest entry the reads below stay inside. */
const SEGMENT_ENTRY_MIN_BYTES = 56;
const SEGMENT_TYPE_INTERPRETER = 3;
const SEGMENT_START_AT = 8;
const SEGMENT_BYTES_AT = 32;
const LITTLE_ENDIAN = true;

const ELF_TYPE_AT = 0x10;
const ELF_MACHINE_AT = 0x12;
const ELF_TYPE_EXECUTABLE = 2;
/** What a position-independent executable is, and what a shared library is too. */
const ELF_TYPE_SHARED = 3;
const ELF_MACHINE_X86 = 0x03;
const ELF_MACHINE_ARM = 0x28;
const ELF_MACHINE_X86_64 = 0x3e;
const ELF_MACHINE_ARM64 = 0xb7;
const ELF_MACHINE_RISCV = 0xf3;

/** Through the machine field: the last of what says whether the guest could run this at all. */
export const ELF_IDENTITY_BYTES = 20;

/** The base a machine nobody named is said in, which is the base every ELF reference lists them in. */
const HEXADECIMAL = 16;

/**
 * What a machine is called where it has a name worth saying back. Only the ones somebody plausibly
 * built by accident — a laptop's own architecture, or the wrong job in a release matrix — because
 * the point of the name is to be recognised by whoever has to go and rebuild.
 */
const ARCHITECTURES = new Map([
  [ELF_MACHINE_X86, 'x86'],
  [ELF_MACHINE_ARM, 'arm'],
  [ELF_MACHINE_X86_64, 'x86-64'],
  [ELF_MACHINE_ARM64, 'arm64'],
  [ELF_MACHINE_RISCV, 'riscv'],
]);

export type ElfIdentity =
  | { outcome: 'guest-executable' }
  | { outcome: 'not-an-executable' }
  | { outcome: 'foreign-architecture'; architecture: string };

/**
 * What the head of an ELF says it is, or `undefined` where there is not yet enough of it to say.
 *
 * The magic alone is four bytes that a shared object, an object file and a build for another
 * machine all carry — and each of those reaches a host as a deploy that never converges rather
 * than as a rejected upload. Sixteen bytes further in, the file says which it is.
 */
export function identifyElf(bytes: Uint8Array): ElfIdentity | undefined {
  if (bytes.length < ELF_IDENTITY_BYTES) {
    return undefined;
  }
  if (!isElfExecutable(bytes)) {
    return { outcome: 'not-an-executable' };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const type = view.getUint16(ELF_TYPE_AT, LITTLE_ENDIAN);
  if (type !== ELF_TYPE_EXECUTABLE && type !== ELF_TYPE_SHARED) {
    return { outcome: 'not-an-executable' };
  }

  const machine = view.getUint16(ELF_MACHINE_AT, LITTLE_ENDIAN);
  const guests =
    machine === ELF_MACHINE_X86_64 &&
    bytes[ELF_CLASS_AT] === ELF_CLASS_64 &&
    bytes[ELF_ENDIANNESS_AT] === ELF_LITTLE_ENDIAN;

  return guests
    ? { outcome: 'guest-executable' }
    : { outcome: 'foreign-architecture', architecture: architectureOf({ machine, bytes }) };
}

/** Whether the guest could exec this, said of as much of the head as is in hand. */
export function isGuestExecutable(bytes: Uint8Array): boolean {
  return identifyElf(bytes)?.outcome === 'guest-executable';
}

// The width is said only where it is the thing that is wrong: an arm64 build is arm64 whether it
// was compiled 32-bit or 64-bit, while a 32-bit x86-64 is a name that reads as a contradiction.
function architectureOf({ machine, bytes }: { machine: number; bytes: Uint8Array }): string {
  const named = ARCHITECTURES.get(machine) ?? `machine 0x${machine.toString(HEXADECIMAL)}`;
  return machine === ELF_MACHINE_X86_64 || bytes[ELF_CLASS_AT] === ELF_CLASS_64
    ? named
    : `32-bit ${named}`;
}

const NUL = '\0';

/**
 * The dynamic loader this binary names, if the prefix given holds it.
 *
 * `undefined` is "this prefix does not say" and never "there is none": a static binary, an ELF
 * this cannot parse, and an interpreter sitting past the prefix are all indistinguishable here,
 * so the caller may only ever reject on a path it actually read.
 */
export function interpreterOf(bytes: Uint8Array): string | undefined {
  if (
    bytes.length < ELF_HEADER_BYTES ||
    bytes[ELF_CLASS_AT] !== ELF_CLASS_64 ||
    bytes[ELF_ENDIANNESS_AT] !== ELF_LITTLE_ENDIAN
  ) {
    return undefined;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
