import { note, text } from '@clack/prompts';
import type { PublicApiClient } from '@repo/api-client/public';
import { appFor, deleteApp as requestDeletion } from '@repo/app-operations';
import { APP_STATES } from '@repo/protocol';
import { z } from 'zod';
import { UsageError } from '#lib/errors.ts';
import { defineOutput } from '#lib/output.ts';
import { answered } from '#lib/prompts.ts';

/**
 * A phrase rather than a y/n, because a y/n is answered by the muscle that has answered every
 * other one. There is nothing underneath this to undo it with: an export goes with the app it
 * was taken of, so not even a bundle downloaded first leaves a copy on the platform.
 */
const CONFIRMATION_PHRASE = 'delete permanently';

const DeletedSchema = z.object({
  slug: z.string(),
  state: z.enum(APP_STATES),
  /** Whether this run is what started the teardown, rather than finding one already under way. */
  changed: z.boolean(),
});

export type Deleted = z.infer<typeof DeletedSchema>;

export const DELETED_OUTPUT = defineOutput({
  schema: DeletedSchema,
  render: ({ value, out }) =>
    out.done(
      value.changed
        ? `${value.slug} is ${value.state}. What is on the volume goes when the host holding it says so.`
        : `${value.slug} is already being deleted.`,
    ),
});

export type DeleteInput = {
  api: PublicApiClient;
  slug: string;
  yes: boolean;
  interactive: boolean;
};

/**
 * Delete an app: the hostnames it answered on, everything its binary ever wrote, every deployment
 * of it, and — once the api has torn it down — every binary uploaded to it and every export taken
 * of it.
 *
 * The app is looked up before anything is asked, so a slug that names nothing costs one line
 * rather than a phrase typed out for an app that was never there.
 */
export async function deleteApp({ api, slug, yes, interactive }: DeleteInput): Promise<Deleted> {
  const { app } = await appFor({ api, slug, operation: 'delete' });
  // Asking twice is asking once: the teardown already running is the answer to the second.
  if (app.state === 'deleting') {
    return { slug: app.slug, state: app.state, changed: false };
  }

  if (!yes) {
    await confirmDeletion({
      slug: app.slug,
      hostnames: app.hostnames.map((each) => each.hostname),
      interactive,
    });
  }

  const deleting = await requestDeletion({ api, appId: app.id });
  return { slug: deleting.slug, state: deleting.state, changed: true };
}

/**
 * `run` takes the defaults when there is nobody to ask; there is no default here that is not the
 * deletion itself, so a pipe without `--yes` is refused rather than answered on the owner's
 * behalf. A prompt nobody can read is not a safeguard.
 */
async function confirmDeletion({
  slug,
  hostnames,
  interactive,
}: {
  slug: string;
  hostnames: readonly string[];
  interactive: boolean;
}): Promise<void> {
  if (!interactive) {
    throw new UsageError(
      `Deleting ${slug} cannot be undone, and there is no terminal here to confirm it through. Pass --yes to mean it.`,
    );
  }

  note(
    [
      `app: ${slug}`,
      `hostnames: ${hostnames.join(' ')}`,
      'volume: everything on it',
      'binaries: every one ever uploaded to this app',
      'exports: every bundle ever taken of it',
    ].join('\n'),
    'Deleted for good',
  );
  answered(
    await text({
      message: `Type ${CONFIRMATION_PHRASE} to delete ${slug}`,
      validate: (value) =>
        saysDeletePermanently(value)
          ? undefined
          : `Type ${CONFIRMATION_PHRASE}, or press Ctrl-C to keep the app.`,
    }),
  );
}

/**
 * Typing the words is what makes this deliberate, so a caps lock left on is not a second chance
 * to think about it and neither is a space either side of them.
 */
export function saysDeletePermanently(typed: string | undefined): boolean {
  return typed?.trim().toLowerCase() === CONFIRMATION_PHRASE;
}
