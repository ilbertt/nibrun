import { text } from '@clack/prompts';
import type { InferOptions } from '@parshjs/core';
import type { PaidRequest, PaidRequestType } from '@repo/api-client/models';
import type { PublicApiClient } from '@repo/api-client/public';
import { MAX_PAID_APPS_REQUEST, MIN_PAID_APPS_REQUEST } from '@repo/api-constants';
import { z } from 'zod';
import type { command } from '#commands/paid-request.ts';
import { PROGRAM_NAME, SHARED_OPTIONS } from '#config.ts';
import { selectApp } from '#lib/apps.ts';
import { UsageError } from '#lib/errors.ts';
import { defineOutput } from '#lib/output.ts';
import { answered } from '#lib/prompts.ts';

const REQUEST_TYPES = [
  'apps',
  'custom-bucket',
  'always-on',
  'resources',
] as const satisfies readonly PaidRequestType[];
type CliPaidRequestType = (typeof REQUEST_TYPES)[number];

export const PAID_REQUEST_TYPE_SCHEMA = z.enum(REQUEST_TYPES, {
  error: `Supported paid request types: ${REQUEST_TYPES.join(', ')}.`,
});

export const APP_PAID_REQUEST_TYPE_SCHEMA = PAID_REQUEST_TYPE_SCHEMA.exclude(['apps']);

export const REQUESTED_APPS_AMOUNT_FLAG = 'requested-apps-amount';

export const REQUESTED_APPS_AMOUNT_SCHEMA = z
  .number()
  .int()
  .min(MIN_PAID_APPS_REQUEST)
  .max(MAX_PAID_APPS_REQUEST);

const PaidRequestOptionsSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal(PAID_REQUEST_TYPE_SCHEMA.enum.apps),
    [REQUESTED_APPS_AMOUNT_FLAG]: REQUESTED_APPS_AMOUNT_SCHEMA.optional(),
  }),
  z.strictObject({
    type: APP_PAID_REQUEST_TYPE_SCHEMA,
    [SHARED_OPTIONS.app.name]: SHARED_OPTIONS.app.option.schema,
  }),
]);

export const PAID_REQUEST_HINT = `Run \`${PROGRAM_NAME} paid-request --type ${PAID_REQUEST_TYPE_SCHEMA.enum.apps}\` to tell us, or pass \`--${REQUESTED_APPS_AMOUNT_FLAG} <total>\` in scripts.`;

export const PAID_REQUEST_OUTPUT = defineOutput({
  schema: z.discriminatedUnion('requestType', [
    z.object({
      requestType: z.literal(PAID_REQUEST_TYPE_SCHEMA.enum.apps),
      requestedAppsAmount: REQUESTED_APPS_AMOUNT_SCHEMA,
    }),
    z.object({
      requestType: APP_PAID_REQUEST_TYPE_SCHEMA,
      appId: z.string(),
    }),
  ]),
  render: function renderRequest({ value, out }) {
    if (value.requestType === PAID_REQUEST_TYPE_SCHEMA.enum.apps) {
      const { requestedAppsAmount } = value;
      out.success(
        `Thanks! We recorded your request for ${requestedAppsAmount} app${requestedAppsAmount === 1 ? '' : 's'} in total. Paid apps are coming.`,
      );
      return;
    }
    const requestedFeatures = {
      'always-on': `keep app ${value.appId} always on`,
      'custom-bucket': `use your own S3-compatible bucket for app ${value.appId}`,
      resources: `get more CPU, RAM, and volume for app ${value.appId}`,
    } satisfies Record<z.infer<typeof APP_PAID_REQUEST_TYPE_SCHEMA>, string>;
    out.success(
      `Thanks! We recorded your request to ${requestedFeatures[value.requestType]}. This does not enable the feature or charge you.`,
    );
  },
});

export async function completePaidRequest({
  options,
  interactive,
  api,
}: {
  options: InferOptions<typeof command.options>;
  interactive: boolean;
  api: PublicApiClient;
}): Promise<Extract<PaidRequest, { requestType: CliPaidRequestType }>> {
  const supplied = Object.fromEntries(
    Object.entries(options).filter(function provided([, value]) {
      return value !== undefined;
    }),
  );
  const parsed = PaidRequestOptionsSchema.safeParse(supplied);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map(function describeIssue(issue) {
        return issue.message;
      })
      .join('; ');
    throw new UsageError(`Invalid options for --type ${options.type}: ${reason}`);
  }
  if (parsed.data.type === PAID_REQUEST_TYPE_SCHEMA.enum.apps) {
    return {
      requestType: parsed.data.type,
      requestedAppsAmount:
        parsed.data[REQUESTED_APPS_AMOUNT_FLAG] ?? (await requestedAppsAmount(interactive)),
    };
  }
  const app = await selectApp({
    api,
    name: parsed.data[SHARED_OPTIONS.app.name],
    interactive,
  });
  return { requestType: parsed.data.type, appId: app.id };
}

async function requestedAppsAmount(interactive: boolean): Promise<number> {
  if (!interactive) {
    throw new UsageError(
      `Pass --${REQUESTED_APPS_AMOUNT_FLAG} with the total you need: ${PROGRAM_NAME} paid-request --type ${PAID_REQUEST_TYPE_SCHEMA.enum.apps} --${REQUESTED_APPS_AMOUNT_FLAG} <${MIN_PAID_APPS_REQUEST}-${MAX_PAID_APPS_REQUEST}>.`,
    );
  }
  const value = answered(
    await text({ message: 'How many apps do you need in total?', validate: validateAmount }),
  );
  return REQUESTED_APPS_AMOUNT_SCHEMA.parse(Number(value));
}

function validateAmount(value: string | undefined): string | undefined {
  return REQUESTED_APPS_AMOUNT_SCHEMA.safeParse(Number(value)).success
    ? undefined
    : `Enter a whole number from ${MIN_PAID_APPS_REQUEST} to ${MAX_PAID_APPS_REQUEST}.`;
}
