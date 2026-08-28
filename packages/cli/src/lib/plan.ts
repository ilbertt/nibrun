import { basename } from 'node:path';
import { confirm, note, select, text } from '@clack/prompts';
import type { PublicApiClient } from '@repo/api-client/public';
import { unwrap } from '@repo/api-client/unwrap';
import { appFor } from '@repo/app-operations';
import { DEFAULT_HTTP_PORT, type TenantArguments } from '@repo/protocol';
import { CancelledError } from '#lib/errors.ts';
import { answered } from '#lib/prompts.ts';

export type RunOptions = {
  app?: string | undefined;
  name?: string | undefined;
  port?: number | undefined;
  env?: string[] | undefined;
  unset?: string[] | undefined;
};

type Plan = {
  options: RunOptions;
  binaryPath: string;
  args: TenantArguments;
};

/**
 * Ask for what the flags left open, then show what it all adds up to.
 *
 * Only the answers that decide where a first deploy lands are asked for — a question asked on
 * every run is one that gets answered without reading it.
 */
export async function completeOptions({
  api,
  options,
  binaryPath,
  args,
}: Plan & { api: PublicApiClient }) {
  const completed = await fillGaps({ api, options, binaryPath });
  await confirmPlan({ options: completed, binaryPath, args });
  return completed;
}

async function fillGaps({
  api,
  options,
  binaryPath,
}: Omit<Plan, 'args'> & { api: PublicApiClient }): Promise<RunOptions> {
  if (options.app !== undefined) {
    // A slug typed rather than chosen has been checked against nothing yet, and a summary saying
    // what the deploy replaces is worse than useless in front of an app it cannot land on.
    await appFor({ api, slug: options.app, operation: 'release' });
    return options;
  }
  const app = await chooseApp({ api });
  if (app !== undefined) {
    return { ...options, app };
  }
  return {
    ...options,
    name: options.name ?? (await askName({ suggestion: basename(binaryPath) })),
    port: options.port ?? (await askPort()),
  };
}

/**
 * `undefined` asks for a new app — which is what an owner with none gets without being asked.
 *
 * Deploying is how a release is replaced, so an owner who already has apps and named none is
 * the one case where guessing is expensive: taken literally they get a second app every run,
 * and taken generously they overwrite one they never named.
 */
async function chooseApp({ api }: { api: PublicApiClient }): Promise<string | undefined> {
  const { apps } = unwrap(await api.api.apps.get());
  const deployable = apps.filter((app) => app.state === 'active');
  if (deployable.length === 0) {
    return undefined;
  }
  const chosen = await select<string | null>({
    message: 'Deploy onto which app?',
    options: [
      { value: null, label: 'A new app' },
      ...deployable.map((app) => ({ value: app.slug, label: app.slug })),
    ],
  });
  return answered(chosen) ?? undefined;
}

async function askName({ suggestion }: { suggestion: string }): Promise<string> {
  const answer = await text({
    message: 'Name the app',
    initialValue: suggestion,
    validate: (value) => (value?.trim() ? undefined : 'The app needs a name.'),
  });
  return answered(answer);
}

// Bounds are the api's to enforce; this only refuses what it could not send as a port at all.
async function askPort(): Promise<number> {
  const answer = await text({
    message: 'Which HTTP port does the binary listen on?',
    initialValue: String(DEFAULT_HTTP_PORT),
    validate: (value) => (Number.isInteger(Number(value)) ? undefined : 'Ports are whole numbers.'),
  });
  return Number(answered(answer));
}

async function confirmPlan({ options, binaryPath, args }: Plan): Promise<void> {
  const creating = options.app === undefined;
  note(summary({ options, binaryPath, args }), creating ? 'New app' : 'Existing app');

  const question = creating
    ? `Create ${options.name} and deploy?`
    : `Deploy onto ${options.app}? This replaces what it is running.`;
  if (!answered(await confirm({ message: question }))) {
    throw new CancelledError();
  }
}

function summary({ options, binaryPath, args }: Plan): string {
  const rows = [
    ['binary', binaryPath],
    ['app', options.app ?? options.name],
    ['port', options.port],
    ['args', args.length === 0 ? undefined : args.join(' ')],
  ];
  return rows
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n');
}
