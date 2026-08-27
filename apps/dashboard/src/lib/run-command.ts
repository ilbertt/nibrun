// What a POSIX shell reads as one word as it stands. Anything else is wrapped in single quotes,
// inside which every character is literal — so an argument holding a space, a quote or a `$` is
// copied out as the one argument it is rather than as whatever a shell would make of it.
const BARE_WORD = /^[\w@%+=:,./-]+$/;

function shellWord(word: string): string {
  return BARE_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/**
 * How the app's binary would be started by hand: the name it was uploaded under, then the
 * arguments it is configured with.
 *
 * The guest execs it from a path of nibrun's own choosing, so this is not the command line any
 * host runs — it is the one an owner can paste beside the binary they still have.
 */
export function runCommand({
  binaryName,
  args,
}: {
  binaryName: string;
  args: readonly string[];
}): string {
  return [`./${binaryName}`, ...args].map(shellWord).join(' ');
}
