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
