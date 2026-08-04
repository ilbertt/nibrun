import { join } from 'node:path';
import {
  type AgentSession,
  DEFAULT_AGENT_POLL_SETTINGS,
  type HostDesiredState,
  HostDesiredStateSchema,
  type HostState,
  type HostVersions,
  type ObjectKey,
  ProtocolValidationError,
  parseMessage,
  type SecretString,
} from '@repo/protocol';
import { InstanceCredentialProvider } from '#aws/instance-credentials.ts';
import { type AgentConfig, loadAgentConfig } from '#config.ts';
import { ControlPlaneClient, ControlPlaneError } from '#control/client.ts';
import { HostIdentity, isSessionExpiring, openSession } from '#control/session.ts';
import { ExportManager } from '#exports/manager.ts';
import { backoffDelayMs } from '#lib/backoff.ts';
import { nowTimestamp } from '#lib/clock.ts';
import { runCommand } from '#lib/exec.ts';
import { readJsonFile, readTextFile, writeJsonFile } from '#lib/json-store.ts';
import { describeError, logger } from '#lib/logger.ts';
import { TenantLogQueue } from '#logs/queue.ts';
import { TenantLogReceiver, tenantLogSocketPath } from '#logs/receiver.ts';
import { readSlotRecords, SlotAllocator } from '#network/allocator.ts';
import { CaddyProxy } from '#proxy/caddy.ts';
import { Reconciler } from '#reconcile/reconciler.ts';
import { buildReportedState } from '#report/build-report.ts';
import {
  allocatableCapacity,
  readAvailableCacheBytes,
  readHostCapacity,
} from '#report/capacity.ts';
import { readHostVersions } from '#report/versions.ts';
import { s3ArtifactBytes } from '#vm/artifacts.ts';
import { VmManager } from '#vm/manager.ts';
import { SystemdVmUnits } from '#vm/systemd.ts';
import { VolumeManager } from '#volumes/manager.ts';
import { ZerofsTopology } from '#volumes/topology.ts';

const STATUS_TICK_MS = 1_000;
const FIRST_GENERATION = 0;

const CONTROL_PLANE_BACKOFF = {
  initialBackoffMs: 1_000,
  maxBackoffMs: 60_000,
  backoffFactor: 2,
};
const FIRST_FAILURE = 1;
const NO_FAILURES = 0;

const DESIRED_STATE_FILENAME = 'desired-state.json';
const TENANT_LOG_BUFFER_BYTES = 8_388_608;
const LOG_RECONNECT_FLOOR_MS = 250;
// The agent ends each upload itself rather than letting one run until something kills it, so a
// stream that ended well inside its own window ended for a reason nobody chose. Counting that as
// a failure is what keeps a misconfigured edge from becoming a silent reconnect loop.
const MIN_HEALTHY_LOG_STREAM_MS = 5_000;
// How long one upload lasts before the agent closes it and opens the next.
//
// The agent ends it rather than the control plane because this request carries its data in the
// body: whoever ends it decides what was in flight at the time, and only the sender knows when
// nothing is. Ended at a drained queue it costs nothing, which is what makes a window this short
// affordable — and short is what keeps a stalled upload from holding a host's output hostage.
const LOG_STREAM_WINDOW_MS = 30_000;
// Silence, not the window, is what an idle timer measures, and a quiet app produces plenty of it
// inside one window. Sending an empty line more often than anything between here and the control
// plane is willing to wait is what lets the window above be chosen for delivery reasons instead
// of to dodge somebody's timeout.
const LOG_KEEPALIVE_INTERVAL_MS = 10_000;

export class Agent {
  readonly #config: AgentConfig;
  readonly #client: ControlPlaneClient;
  readonly #identity: HostIdentity;
  readonly #reconciler: Reconciler;
  readonly #vms: VmManager;
  readonly #logs: TenantLogReceiver;
  readonly #logQueue: TenantLogQueue;
  readonly #versions: HostVersions;
  #session: AgentSession | undefined;
  #lastDesired: HostDesiredState | undefined;
  #knownGeneration = FIRST_GENERATION;
  #running = true;
  #logUploadAbort: AbortController | undefined;

  private constructor({
    config,
    versions,
    reconciler,
    vms,
    logs,
    logQueue,
  }: {
    config: AgentConfig;
    versions: HostVersions;
    reconciler: Reconciler;
    vms: VmManager;
    logs: TenantLogReceiver;
    logQueue: TenantLogQueue;
  }) {
    this.#config = config;
    this.#versions = versions;
    this.#reconciler = reconciler;
    this.#vms = vms;
    this.#logs = logs;
    this.#logQueue = logQueue;
    this.#client = new ControlPlaneClient({ baseUrl: config.controlPlaneUrl });
    this.#identity = new HostIdentity({ path: config.hostIdFile });
  }

  static async create({ config = loadAgentConfig() }: { config?: AgentConfig } = {}) {
    const runner = runCommand;
    const versions = await readHostVersions({ path: config.versionsFile });
    // v1 runs one ZeroFS per host, so every volume placed here shares one storage prefix. The
    // reasoning and what it costs are in `volumes/topology.ts`; everything downstream resolves
    // per volume, so a per-app shape is a second factory rather than a rewrite.
    const topology = ZerofsTopology.sharedHostFilesystem({
      runner,
      storagePrefix: config.zerofsStoragePrefix as ObjectKey,
      mountPath: config.zerofsMount,
      nbdSocketPath: config.zerofsNbdSocket,
      binary: config.zerofsBinary,
      configFile: config.zerofsConfigFile,
    });
    const units = new SystemdVmUnits({ runner });
    const credentials = new InstanceCredentialProvider();
    const artifacts = s3ArtifactBytes({
      bucket: config.artifactBucket,
      region: config.awsRegion,
      credentials,
    });
    // One allocator, shared: the host port, the tap, the guest address and the NBD minor are
    // four views of the same slot, and two owners of it would eventually disagree.
    const allocator = SlotAllocator.fromRecords(
      readSlotRecords(await readJsonFile({ path: config.slotsFile })),
    );
    const logQueue = new TenantLogQueue({ maxBytes: TENANT_LOG_BUFFER_BYTES });
    let droppedLogEvents = 0;
    const logs = new TenantLogReceiver({
      publish: (event) => {
        if (logQueue.push(event)) {
          return;
        }
        droppedLogEvents += 1;
        if ((droppedLogEvents & (droppedLogEvents - 1)) === 0) {
          logger.warn({
            message: 'tenant log upload buffer full',
            droppedEvents: droppedLogEvents,
          });
        }
      },
    });
    const vms = new VmManager({
      runner,
      units,
      artifacts,
      artifactCacheDir: config.artifactCacheDir,
      guestImageDir: config.guestImageDir,
      vmDir: config.vmDir,
      guestDnsServers: config.guestDnsServers,
      logs,
    });
    const reconciler = new Reconciler({
      config,
      runner,
      units,
      topology,
      allocator,
      proxy: new CaddyProxy({ runner, sitesFile: config.caddySitesFile }),
      exports: new ExportManager({
        runner,
        topology,
        artifacts,
        credentials,
        bucket: config.exportBucket,
        region: config.awsRegion,
        stagingDir: config.exportStagingDir,
      }),
      vms,
      volumes: new VolumeManager({ runner, topology, allocator }),
    });
    return new Agent({ config, versions, reconciler, vms, logs, logQueue });
  }

  stop() {
    this.#running = false;
    this.#logUploadAbort?.abort();
    this.#logQueue.close();
  }

  /**
   * Converges against the last desired state this host was given before it has even reached
   * the control plane, then joins the poll.
   *
   * The cached copy is what makes an agent restart during a control-plane outage a non-event:
   * the host still knows what it is supposed to be running, and the poll that follows only
   * ever corrects it.
   */
  async run(): Promise<void> {
    await this.#reconciler.load();
    await this.#restoreLogReceivers();
    const cached = await this.#readCachedDesiredState();
    if (cached) {
      this.#knownGeneration = cached.generation;
      this.#lastDesired = cached;
      await this.#reconcileSafely(cached);
    }

    await this.#ensureSession();
    const statusLoop = this.#runStatusLoop();
    const reportLoop = this.#runReportLoop();
    const logLoop = this.#runLogLoop();
    await this.#runPollLoop();
    await Promise.all([statusLoop, reportLoop, logLoop]);
    await this.#logs.close();
  }

  async #restoreLogReceivers(): Promise<void> {
    for (const record of this.#reconciler.records()) {
      try {
        await this.#logs.attach({
          source: {
            instanceId: record.instanceId,
            appId: record.appId,
            deploymentId: record.deploymentId,
          },
          socketPath: tenantLogSocketPath({ workingDir: this.#vms.workingDir(record.instanceId) }),
        });
      } catch (error) {
        logger.warn({
          message: 'tenant log receiver restore failed',
          instanceId: record.instanceId,
          ...describeError(error),
        });
      }
    }
  }

  async #runLogLoop(): Promise<void> {
    let failures = NO_FAILURES;
    while (this.#running) {
      const abort = new AbortController();
      this.#logUploadAbort = abort;
      const body = this.#logQueue.readable();
      const startedAtMs = performance.now();
      const keepalive = setInterval(() => {
        this.#logQueue.keepalive();
      }, LOG_KEEPALIVE_INTERVAL_MS);
      keepalive.unref();
      const window = setTimeout(() => {
        this.#logQueue.endStream();
      }, LOG_STREAM_WINDOW_MS);
      window.unref();
      try {
        const session = await this.#ensureSession();
        await this.#client.streamTenantLogs({
          sessionToken: session.sessionToken,
          body,
          signal: abort.signal,
        });
        const elapsedMs = performance.now() - startedAtMs;
        if (elapsedMs < MIN_HEALTHY_LOG_STREAM_MS) {
          failures += FIRST_FAILURE;
          logger.warn({ message: 'tenant log stream ended without carrying anything', elapsedMs });
        } else {
          failures = NO_FAILURES;
        }
      } catch (error) {
        if (!this.#running) {
          break;
        }
        failures += FIRST_FAILURE;
        if (error instanceof ControlPlaneError && error.isSessionExpired) {
          this.#session = undefined;
        }
        logger.warn({ message: 'tenant log stream failed', ...describeError(error) });
      } finally {
        clearTimeout(window);
        clearInterval(keepalive);
        abort.abort();
        if (this.#logUploadAbort === abort) {
          this.#logUploadAbort = undefined;
        }
      }
      // Reaching the end of a window is not a retry, so it does not wait: the next upload opens
      // immediately and whatever the tenant wrote in between is already queued for it.
      if (this.#running && failures > NO_FAILURES) {
        const retryMs = Math.max(
          LOG_RECONNECT_FLOOR_MS,
          backoffDelayMs({ attempt: failures, policy: CONTROL_PLANE_BACKOFF }),
        );
        await Bun.sleep(retryMs);
      }
    }
  }

  async #runPollLoop(): Promise<void> {
    let failures = NO_FAILURES;
    while (this.#running) {
      try {
        const session = await this.#ensureSession();
        const response = await this.#client.fetchDesiredState({
          sessionToken: session.sessionToken,
          request: { knownGeneration: this.#knownGeneration },
        });
        failures = NO_FAILURES;
        if (response.result === 'changed') {
          await writeJsonFile({ path: this.#desiredStatePath(), value: response.state });
          this.#knownGeneration = response.state.generation;
          this.#lastDesired = response.state;
          await this.#reconcileSafely(response.state);
        } else if (this.#reconciler.deferredWork && this.#lastDesired) {
          // The only thing that re-runs a reconcile is the generation changing, and work the
          // last one deferred does not change it. A volume waiting on an instance to stop would
          // otherwise sit until some unrelated edit came along to carry it.
          await this.#reconcileSafely(this.#lastDesired);
        }
        await Bun.sleep(session.poll.minIntervalMs);
      } catch (error) {
        failures += FIRST_FAILURE;
        this.#handlePollError(error);
        await Bun.sleep(backoffDelayMs({ attempt: failures, policy: CONTROL_PLANE_BACKOFF }));
      }
    }
  }

  #handlePollError(error: unknown): void {
    if (error instanceof ControlPlaneError && error.isSessionExpired) {
      this.#session = undefined;
    }
    if (error instanceof ProtocolValidationError) {
      logger.error({ message: 'desired state rejected by validation', issues: error.issues });
      return;
    }
    logger.warn({ message: 'desired state poll failed', ...describeError(error) });
  }

  async #runStatusLoop(): Promise<void> {
    while (this.#running) {
      try {
        await this.#reconciler.refreshStates();
      } catch (error) {
        logger.warn({ message: 'status refresh failed', ...describeError(error) });
      }
      await Bun.sleep(STATUS_TICK_MS);
    }
  }

  async #runReportLoop(): Promise<void> {
    while (this.#running) {
      const interval =
        this.#session?.poll.reportIntervalMs ?? DEFAULT_AGENT_POLL_SETTINGS.reportIntervalMs;
      try {
        await this.#report();
      } catch (error) {
        logger.warn({ message: 'report failed', ...describeError(error) });
      }
      await Bun.sleep(interval);
    }
  }

  async #report(): Promise<void> {
    const session = await this.#ensureSession();
    const records = this.#reconciler.records();
    const capacity = await readHostCapacity({ cacheDir: this.#config.stateDir });
    const report = buildReportedState({
      hostId: session.hostId,
      observedGeneration: this.#reconciler.observedGeneration,
      reportedAt: nowTimestamp(),
      state: this.#hostState(),
      capacity,
      allocatable: allocatableCapacity({
        capacity,
        committed: records
          .filter((record) => record.state !== 'stopped' && record.state !== 'failed')
          .map((record) => record.resources),
        availableCacheBytes: await readAvailableCacheBytes({ cacheDir: this.#config.stateDir }),
      }),
      versions: this.#versions,
      records,
      volumes: this.#reconciler.volumeReports(),
      checkpoints: this.#reconciler.checkpointReports(),
      exports: this.#reconciler.exportReports(),
    });
    await this.#client.sendReportedState({ sessionToken: session.sessionToken, report });
  }

  #hostState(): HostState {
    return this.#reconciler.converged ? 'ready' : 'registering';
  }

  async #ensureSession(): Promise<AgentSession> {
    if (this.#session && !isSessionExpiring({ session: this.#session, nowMs: Date.now() })) {
      return this.#session;
    }
    const capacity = await readHostCapacity({ cacheDir: this.#config.stateDir });
    this.#session = await openSession({
      client: this.#client,
      identity: this.#identity,
      inputs: { versions: this.#versions, capacity },
    });
    logger.info({
      message: 'session opened',
      hostId: this.#session.hostId,
      expiresAt: this.#session.expiresAt,
    });
    return this.#session;
  }

  #desiredStatePath() {
    return join(this.#config.stateDir, DESIRED_STATE_FILENAME);
  }

  async #readCachedDesiredState(): Promise<HostDesiredState | undefined> {
    const value = await readJsonFile({ path: this.#desiredStatePath() });
    if (value === undefined) {
      return undefined;
    }
    try {
      return parseMessage({ schema: HostDesiredStateSchema, value });
    } catch (error) {
      logger.warn({ message: 'cached desired state discarded', ...describeError(error) });
      return undefined;
    }
  }

  async #reconcileSafely(desired: HostDesiredState): Promise<void> {
    try {
      await this.#reconciler.reconcile({ desired });
    } catch (error) {
      logger.error({
        message: 'reconcile failed',
        generation: desired.generation,
        ...describeError(error),
      });
    }
  }
}
