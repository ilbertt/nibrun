import { defineCommand } from '@parshjs/core';
import {
  APP_ACTIVATIONS_EXPLAINED,
  idleTimeoutLabel,
  parseIdleTimeout,
} from '@repo/app-operations';
import { APP_ACTIVATIONS, MIN_IDLE_TIMEOUT_MS } from '@repo/protocol';
import { z } from 'zod';
import { changeActivation, showActivation } from '#lib/activation.ts';
import { selectApp } from '#lib/apps.ts';
import { requireSignedIn } from '#lib/credentials.ts';
import { createUi, isInteractive } from '#lib/ui.ts';

const SET_FLAG = 'set';
const IDLE_TIMEOUT_FLAG = 'idle-timeout';

// The values and what each one costs, read from the one record that holds both, so a third
// activation is a row there rather than a sentence to remember to change here.
const CHOICES = APP_ACTIVATIONS.map(
  (activation) => `${activation} — ${APP_ACTIVATIONS_EXPLAINED[activation].costs}`,
).join(' ');

export const command = defineCommand('apps activation', {
  description:
    'Read or change how the app is brought up. Nothing is uploaded and no release is made — the host reads this off the app on its next poll.',
  options: {
    [SET_FLAG]: {
      schema: z.enum(APP_ACTIVATIONS).optional(),
      description: `How the app comes up. ${CHOICES} Omit every flag to read what it is now.`,
    },
    [IDLE_TIMEOUT_FLAG]: {
      schema: z.string().optional(),
      description: `How long an on-request app may go unasked-for before its microVM is stopped, as a duration such as 15m or 2h. No shorter than ${idleTimeoutLabel(MIN_IDLE_TIMEOUT_MS)}, which is how often a host measures whether an app has gone quiet. Kept while the app is always on, so turning the saving off and on again gives this back.`,
    },
  },
  beforeHandler: ({ context }) => requireSignedIn(context),
  handler: async ({ options, parents, context, print }) => {
    const { api } = context;
    const interactive = isInteractive();
    const activation = options[SET_FLAG];
    const timeout = options[IDLE_TIMEOUT_FLAG];

    const slug = await selectApp({ api, slug: parents.apps.options.app, interactive });
    if (activation === undefined && timeout === undefined) {
      await showActivation({ api, slug, print });
      return;
    }

    const ui = createUi({ print, interactive });
    ui.open('nib apps activation');
    await changeActivation({
      api,
      slug,
      ui,
      print,
      edit: {
        ...(activation !== undefined && { activation }),
        ...(timeout !== undefined && { idleTimeoutMs: parseIdleTimeout(timeout) }),
      },
    });
  },
});
