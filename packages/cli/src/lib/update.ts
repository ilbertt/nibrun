import type { PublicApiClient } from '@repo/api-client/public';
import { redeploy } from '@repo/app-operations';
import type { TenantArguments } from '@repo/protocol';
import { environmentEdit } from '#lib/environment.ts';
import { announce, awaitServing } from '#lib/release.ts';
import type { Ui } from '#lib/ui.ts';

export type UpdateInput = {
  api: PublicApiClient;
  ui: Ui;
  slug: string;
  args?: TenantArguments | undefined;
  port?: number | undefined;
  env?: string[] | undefined;
  unset?: string[] | undefined;
  detach?: boolean | undefined;
};

/**
 * Reconfigure the app by whatever the flags named, and run it again on the binary it already has.
 *
 * Everything unnamed is left as the app has it, arguments included: a caller changing one variable
 * has said nothing about how the binary is started, and reading that as "start it bare" would take
 * the app down on the way to setting a variable.
 */
export async function updateApp({
  api,
  ui,
  slug,
  args,
  port,
  env,
  unset,
  detach,
}: UpdateInput): Promise<void> {
  const deployed = await redeploy({
    api,
    app: slug,
    args,
    port,
    environment: environmentEdit({ env, unset }),
    onStep: (step) => announce({ step, ui }),
  });

  await awaitServing({ api, ui, deployed, detach });
}
