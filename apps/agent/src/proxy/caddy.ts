import { type CommandRunner, runCommandOrThrow } from '#lib/exec.ts';
import { writeTextFile } from '#lib/json-store.ts';
import { renderAppSites } from '#proxy/caddyfile.ts';
import type { RouteTarget } from '#report/routes.ts';

const SYSTEMCTL = 'systemctl';
const CADDY_UNIT = 'nibrun-caddy.service';

// The proxy reads this as its own unprivileged user, and there is nothing secret in it.
const SITE_FILE_MODE = 0o644;

/**
 * The local proxy's config, projected from the instances this host is actually running.
 *
 * The process that knows what is running is the process that writes the routing config, which is
 * why there is no routing table in the control plane and no way for the two to disagree.
 */
export class CaddyProxy {
  readonly #runner: CommandRunner;
  readonly #sitesFile: string;
  #applied: string | undefined;

  constructor({ runner, sitesFile }: { runner: CommandRunner; sitesFile: string }) {
    this.#runner = runner;
    this.#sitesFile = sitesFile;
  }

  /**
   * Reloaded rather than restarted: a route appearing or disappearing for one app must not
   * interrupt traffic to the others this host is serving.
   *
   * The first call always writes, because what is on disk was written by whichever agent ran
   * before this one and the host may have changed since.
   */
  async apply({ routes }: { routes: readonly RouteTarget[] }): Promise<void> {
    const sites = renderAppSites(routes);
    if (sites === this.#applied) {
      return;
    }
    await writeTextFile({ path: this.#sitesFile, value: sites, mode: SITE_FILE_MODE });
    await runCommandOrThrow({
      runner: this.#runner,
      request: { command: [SYSTEMCTL, 'reload', CADDY_UNIT] },
    });
    this.#applied = sites;
  }
}
