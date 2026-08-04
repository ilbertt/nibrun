import { Effect, Option, Ref } from 'effect';
import { AgentConfig } from '#config.ts';
import { stdoutOf } from '#lib/exec.ts';
import { writeTextFile } from '#lib/json-store.ts';
import { renderAppSites } from '#proxy/caddyfile.ts';
import type { RouteTarget } from '#report/routes.ts';

const SYSTEMCTL = 'systemctl';
const CADDY_UNIT = 'nibrun-caddy.service';

/** The proxy reads this as its own unprivileged user, and there is nothing secret in it. */
const SITE_FILE_MODE = 0o644;

/**
 * The process that knows what is running writes the routing config, which is why there is no
 * routing table in the control plane and no way for the two to disagree.
 */
export class CaddyProxy extends Effect.Service<CaddyProxy>()('CaddyProxy', {
  effect: Effect.gen(function* () {
    const config = yield* AgentConfig;
    // Never written by this process yet, so the first apply always writes: what is on disk came
    // from whichever agent ran before, and the host may have changed since.
    const applied = yield* Ref.make(Option.none<string>());

    return {
      apply: (routes: readonly RouteTarget[]) =>
        Effect.gen(function* () {
          const sites = renderAppSites(routes);
          if (Option.getOrUndefined(yield* Ref.get(applied)) === sites) {
            return;
          }
          yield* writeTextFile({
            path: config.caddySitesFile,
            value: sites,
            mode: SITE_FILE_MODE,
          });
          // Reloaded, not restarted: one app's route must not interrupt the others.
          yield* stdoutOf({ command: [SYSTEMCTL, 'reload', CADDY_UNIT] });
          yield* Ref.set(applied, Option.some(sites));
        }),
    };
  }),
}) {}
