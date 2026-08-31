import type { Print } from '@parshjs/core';
import type { PublicApiClient } from '@repo/api-client/public';
import {
  type ActivatedApp,
  type ActivationEdit,
  APP_ACTIVATIONS_EXPLAINED,
  activationSummary,
  appBySlug,
  ON_REQUEST_LIMITS,
  setActivation,
} from '@repo/app-operations';
import type { Ui } from '#lib/ui.ts';

type ActivationView = Omit<ActivatedApp, 'slug'>;

/**
 * What the setting costs, and — for the one that has them — the two things that stay true of a
 * sleeping app however long its timeout is. Dimmed and under the answer, because they qualify a
 * choice rather than being one.
 */
function explain({ app, print }: { app: ActivationView; print: Print }): void {
  print.dim(APP_ACTIVATIONS_EXPLAINED[app.activation].costs);
  if (app.activation !== 'on-request') {
    return;
  }
  for (const limit of ON_REQUEST_LIMITS) {
    print.dim(`- ${limit}`);
  }
}

export async function showActivation({
  api,
  slug,
  print,
}: {
  api: PublicApiClient;
  slug: string;
  print: Print;
}): Promise<void> {
  const app = await appBySlug({ api, slug });
  print.info(`${app.slug}  ${activationSummary(app)}`);
  print.info('');
  explain({ app, print });
}

export async function changeActivation({
  api,
  slug,
  edit,
  ui,
  print,
}: {
  api: PublicApiClient;
  slug: string;
  edit: ActivationEdit;
  ui: Ui;
  print: Print;
}): Promise<void> {
  const app = await appBySlug({ api, slug });
  const changed = await setActivation({ api, appId: app.id, edit });

  // Said out loud because nothing was uploaded and no release appeared: an owner who expected a
  // deploy would otherwise go looking for one that was never made.
  ui.done(
    `${changed.slug} is ${activationSummary(changed)}. Its host reads this on its next poll.`,
  );
  explain({ app: changed, print });
}
