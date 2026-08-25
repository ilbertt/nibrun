import { rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PublicApiClient } from '@repo/api-client/public';
import { ApiError } from '@repo/api-client/unwrap';
import { appBySlug, awaitExportBundle, requestExport } from '@repo/app-operations';
import { UsageError } from '#lib/errors.ts';
import type { Ui } from '#lib/ui.ts';

/** What the host writes, so what the file is called when the caller left the naming to us. */
const BUNDLE_SUFFIX = '.tar.gz';

/**
 * Written under a name of its own and renamed into place: a transfer that stops part-way would
 * otherwise leave something that looks like the export and is not one.
 */
const PARTIAL_SUFFIX = '.partial';

const BYTES_PER_MIB = 1_048_576;
const MIB_DECIMALS = 1;

export type ExportInput = {
  api: PublicApiClient;
  slug: string;
  destination: string;
  ui: Ui;
};

/**
 * Ask for a copy of an app — its data, the binary that ran against it and the variables it was
 * deployed with — and write it where the caller said.
 *
 * Where it goes is settled before the export is asked for, because reading a tenant's whole
 * filesystem is the most expensive thing the platform does on an owner's behalf: a path that
 * cannot be written is worth one line now rather than one line several minutes from now.
 */
export async function exportApp({ api, slug, destination, ui }: ExportInput): Promise<void> {
  const path = await bundlePath({ destination, slug });
  const app = await appBySlug({ api, slug });

  const requested = await requestExport({ api, appId: app.id });
  ui.step(`export ${requested.id}`);

  const bundle = await ui.waitingFor({
    message: 'preparing the bundle',
    task: () => awaitExportBundle({ api, appId: app.id, exportId: requested.id }),
  });
  await ui.waitingFor({
    message: describeDownload(bundle.sizeBytes),
    task: () => download({ url: bundle.downloadUrl, path }),
  });

  ui.done(path);
}

/**
 * A directory is somewhere to put the bundle rather than a name for it, so the app names it
 * there. Anything else is the name itself, suffix or no suffix — someone who typed a filename has
 * said what they want it called.
 */
export async function bundlePath({
  destination,
  slug,
}: {
  destination: string;
  slug: string;
}): Promise<string> {
  const path = (await isDirectory(destination))
    ? join(destination, `${slug}${BUNDLE_SUFFIX}`)
    : destination;

  const parent = dirname(path);
  if (!(await isDirectory(parent))) {
    throw new UsageError(`No such directory: ${parent}.`);
  }
  // An export is a moment rather than a running copy, so replacing one with another loses the
  // moment. Refusing is what leaves that decision with whoever typed the path.
  if (await Bun.file(path).exists()) {
    throw new UsageError(`${path} already exists.`);
  }
  return path;
}

/**
 * Streamed to disk rather than read first: a bundle is the whole of what the app has written, and
 * this process has no reason to hold any of it.
 */
async function download({ url, path }: { url: string; path: string }): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || response.body === null) {
    throw new ApiError(`The bundle could not be downloaded: ${response.status}.`);
  }

  const partial = `${path}${PARTIAL_SUFFIX}`;
  try {
    await writeStream({ stream: response.body, path: partial });
    await rename(partial, path);
  } catch (failure) {
    await rm(partial, { force: true });
    throw failure;
  }
}

/**
 * `Bun.write` takes a `Response` and would be the whole of this, but in Bun 1.4 it never settles
 * when the body arrives in more than one piece: nothing is written, nothing throws, and the
 * download waits for good. A body that arrives at once is fine, which is why a local server does
 * not show it and every real transfer does. Reading the stream is the same thing said in a way
 * that finishes.
 */
export async function writeStream({
  stream,
  path,
}: {
  stream: ReadableStream<Uint8Array>;
  path: string;
}): Promise<void> {
  const sink = Bun.file(path).writer();
  try {
    for await (const chunk of stream) {
      sink.write(chunk);
    }
  } finally {
    await sink.end();
  }
}

/**
 * Said before the transfer rather than after it, because what a reader wants from it is how long
 * they are about to wait. MiB is the unit a bundle is usually in, and a rounded `0.0` would be
 * worse than no size at all for the one that is not.
 */
function describeDownload(sizeBytes: number | undefined): string {
  if (sizeBytes === undefined) {
    return 'downloading the bundle';
  }
  if (sizeBytes < BYTES_PER_MIB) {
    return `downloading ${sizeBytes} bytes`;
  }
  return `downloading ${(sizeBytes / BYTES_PER_MIB).toFixed(MIB_DECIMALS)} MiB`;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
