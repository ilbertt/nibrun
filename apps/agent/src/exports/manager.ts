import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { DesiredArtifact, DesiredExport, ReportedExport } from '@repo/protocol';
import type { InstanceCredentialProvider } from '#aws/instance-credentials.ts';
import { writeBundle } from '#exports/bundle.ts';
import { nowTimestamp } from '#lib/clock.ts';
import type { CommandRunner } from '#lib/exec.ts';
import { logger } from '#lib/logger.ts';
import type { ArtifactBytes } from '#vm/artifacts.ts';
import type { ZerofsTopology } from '#volumes/topology.ts';

const UPLOAD_PART_SIZE_BYTES = 8_388_608;
const UPLOAD_QUEUE_SIZE = 4;
const UPLOAD_RETRIES = 3;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Structural rather than schema-driven, for the same reason as `readInstanceRecords`: this is
// the agent's own note of what it wrote, not a message from another program. A record that
// cannot be read back is dropped, which costs one re-written bundle rather than a failed start.
function isReportedExport(value: unknown): value is ReportedExport {
  return isObject(value) && typeof value.exportId === 'string' && typeof value.state === 'string';
}

export function readExportReports(value: unknown): ReportedExport[] {
  return Array.isArray(value) ? value.filter(isReportedExport) : [];
}

export type ExportManagerOptions = {
  runner: CommandRunner;
  topology: ZerofsTopology;
  artifacts: ArtifactBytes;
  credentials: InstanceCredentialProvider;
  bucket: string;
  region: string;
  stagingDir: string;
};

export class ExportManager {
  readonly #options: ExportManagerOptions;

  constructor(options: ExportManagerOptions) {
    this.#options = options;
  }

  /**
   * Writes one bundle and uploads it, then removes every local trace of it.
   *
   * The staging tree is a second copy of a tenant's entire dataset sitting in the clear on a
   * shared host, so it is deleted whether or not the upload worked — a failed export must not
   * leave one behind for the next one to trip over or for anything else on the box to read.
   */
  async write({
    desired,
    artifact,
    devicePath,
  }: {
    desired: DesiredExport;
    artifact: DesiredArtifact;
    devicePath: string;
  }): Promise<ReportedExport> {
    const stagingDir = join(this.#options.stagingDir, desired.exportId);
    try {
      // Under `ignore_fsync` the guest's own barriers are not durability points, so this is what
      // turns its acknowledged writes into bytes the device will actually hand back.
      await this.#options.topology.place().admin.flush();

      const bundle = await writeBundle({
        runner: this.#options.runner,
        artifacts: this.#options.artifacts,
        artifact,
        devicePath,
        stagingDir,
      });
      await this.#upload({ path: bundle.path, objectKey: desired.objectKey });

      logger.info({
        message: 'export written',
        exportId: desired.exportId,
        objectKey: desired.objectKey,
        sizeBytes: bundle.sizeBytes,
      });
      return {
        exportId: desired.exportId,
        state: 'ready',
        sizeBytes: bundle.sizeBytes,
        readyAt: nowTimestamp(),
      };
    } finally {
      await rm(stagingDir, { recursive: true, force: true });
    }
  }

  async #upload({ path, objectKey }: { path: string; objectKey: string }): Promise<void> {
    const resolved = await this.#options.credentials.resolve();
    const client = new Bun.S3Client({
      bucket: this.#options.bucket,
      region: this.#options.region,
      accessKeyId: resolved.accessKeyId,
      secretAccessKey: resolved.secretAccessKey,
      ...(resolved.sessionToken ? { sessionToken: resolved.sessionToken } : {}),
    });

    // Streamed in parts rather than read into memory: a bundle is a tenant's whole dataset, and
    // the host has no bound on it that this process could hold.
    //
    // A throw before `end()` leaves the multipart upload uncommitted rather than publishing a
    // truncated bundle, and the bucket's `abort_incomplete_multipart_upload` rule reaps it —
    // which is why writing exports needs no delete permission.
    const writer = client.file(objectKey).writer({
      partSize: UPLOAD_PART_SIZE_BYTES,
      queueSize: UPLOAD_QUEUE_SIZE,
      retry: UPLOAD_RETRIES,
    });
    for await (const chunk of Bun.file(path).stream()) {
      writer.write(chunk);
    }
    await writer.end();
  }
}
