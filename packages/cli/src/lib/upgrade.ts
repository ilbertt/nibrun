import { access, constants } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { ApiError } from '@repo/api-client/unwrap';
import { PROGRAM_NAME } from '#config.ts';
import { UsageError } from '#lib/errors.ts';

/**
 * The script an owner installs with is the script an owner upgrades with. Resolving the newest
 * `cli-v*` release, checking what arrives against the checksum that release publishes and renaming
 * it into place are all its, and none of it is worth saying a second time here.
 *
 * Fetched rather than compiled in, because the nib running an upgrade is by definition the old one:
 * a github that moves its release feed is then a fix every nib ever shipped picks up, rather than
 * one only a nib built after it can.
 */
const INSTALL_SCRIPT_URL = 'https://nibrun.com/install.sh';

/** Where the script installs what it downloads, and the whole of what this tells it. */
const INSTALL_DIR_VAR = 'NIB_INSTALL_DIR';

/** The filesystem Bun mounts a compiled executable's own sources under, and nothing else. */
const COMPILED_ROOT = '/$bunfs/';

/**
 * Replace the running nib with the newest released one, by running the install. What is decided
 * here is only what the script cannot know: which nib is running, and so which one to replace.
 */
export async function upgradeCli({ binary }: { binary: string }): Promise<void> {
  const installDir = dirname(binary);

  requireReplaceable(binary);
  await requireWritable(installDir);
  await runInstallScript({ script: await installScript(), installDir });
}

/**
 * The binary an upgrade replaces, which is this one. `bun run src/main.ts` is not a released nib —
 * `execPath` there is Bun itself, and Bun is not what anybody asked to have replaced.
 */
export function installedBinary(): string {
  if (!Bun.main.startsWith(COMPILED_ROOT)) {
    throw new UsageError(
      `This ${PROGRAM_NAME} runs from source rather than from a release, so there is nothing to upgrade.`,
    );
  }
  return process.execPath;
}

/**
 * The script writes `$NIB_INSTALL_DIR/nib`, so a nib that has been renamed is one it would install
 * beside rather than replace. Refusing is better than reporting an upgrade that left the binary
 * that ran it exactly where it was.
 */
function requireReplaceable(binary: string): void {
  if (basename(binary) !== PROGRAM_NAME) {
    throw new UsageError(
      `The install replaces a binary called ${PROGRAM_NAME}, and this one is ${basename(binary)}. Install it again under its own name to upgrade it.`,
    );
  }
}

/**
 * Asked before the script is fetched rather than left to the `mktemp` inside it: a nib installed
 * where only root can write is a nib only root can replace, and that is worth saying in the words
 * `nib` refuses anything else in.
 */
async function requireWritable(dir: string): Promise<void> {
  try {
    await access(dir, constants.W_OK);
  } catch {
    throw new UsageError(
      `${dir} is not writable by this user, so ${PROGRAM_NAME} cannot replace itself there. Run this as whoever owns it.`,
    );
  }
}

async function installScript(): Promise<string> {
  const response = await fetch(INSTALL_SCRIPT_URL);
  if (!response.ok) {
    throw new ApiError(`${INSTALL_SCRIPT_URL} could not be read: ${response.status}.`);
  }
  return response.text();
}

/**
 * Piped to `sh` rather than fetched by it, so the only thing this asks of the machine is the shell
 * that `curl -fsSL … | sh` already asks of it — the same script, arriving the same way.
 *
 * The terminal is the script's: it says which release it found, what it checked and where the
 * result went, and a commentary written over the top of that would only disagree with it.
 */
export async function runInstallScript({
  script,
  installDir,
}: {
  script: string;
  installDir: string;
}): Promise<void> {
  const installing = Bun.spawn(['sh'], {
    stdin: new TextEncoder().encode(script),
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, [INSTALL_DIR_VAR]: installDir },
  });

  if ((await installing.exited) !== 0) {
    throw new ApiError(`The install did not finish, so ${PROGRAM_NAME} was not replaced.`);
  }
}
