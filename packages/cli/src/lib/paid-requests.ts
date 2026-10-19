import { text } from '@clack/prompts';
import type { InferOptions } from '@parshjs/core';
import type { PaidRequest, PaidRequestType } from '@repo/api-client/models';
import { MAX_PAID_APPS_REQUEST, MIN_PAID_APPS_REQUEST } from '@repo/api-constants';
import { z } from 'zod';
import type { command } from '#commands/paid-request.ts';
import { PROGRAM_NAME } from '#config.ts';
import { UsageError } from '#lib/errors.ts';
import { defineOutput } from '#lib/output.ts';
import { answered } from '#lib/prompts.ts';

const REQUEST_LABELS = {
  apps: { question: 'How many apps do you need in total?', unit: 'app' },
} satisfies Record<PaidRequestType, { question: string; unit: string }>;

const REQUEST_TYPES = Object.keys(REQUEST_LABELS) as [PaidRequestType, ...PaidRequestType[]];

export const PAID_REQUEST_TYPE_SCHEMA = z.enum(REQUEST_TYPES, {
  error: `Supported paid request types: ${REQUEST_TYPES.join(', ')}.`,
});

export const REQUESTED_APPS_AMOUNT_FLAG = 'requested-apps-amount';

export const REQUESTED_APPS_AMOUNT_SCHEMA = z
  .number()
  .int()
  .min(MIN_PAID_APPS_REQUEST)
  .max(MAX_PAID_APPS_REQUEST);

const PaidRequestOptionsSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal(PAID_REQUEST_TYPE_SCHEMA.enum.apps),
    [REQUESTED_APPS_AMOUNT_FLAG]: REQUESTED_APPS_AMOUNT_SCHEMA,
  }),
]);

export const PAID_REQUEST_HINT = `Run \`${PROGRAM_NAME} paid-request --type ${PAID_REQUEST_TYPE_SCHEMA.enum.apps}\` to tell us, or pass \`--${REQUESTED_APPS_AMOUNT_FLAG} <total>\` in scripts.`;

export const PAID_REQUEST_OUTPUT = defineOutput({
  schema: z.object({
    requestType: PAID_REQUEST_TYPE_SCHEMA,
    requestedAppsAmount: REQUESTED_APPS_AMOUNT_SCHEMA,
  }),
  render: function renderRequest({ value, out }) {
    const { requestType, requestedAppsAmount } = value;
    const unit = REQUEST_LABELS[requestType].unit;
    out.success(
      `Thanks! We recorded your request for ${requestedAppsAmount} ${unit}${requestedAppsAmount === 1 ? '' : 's'} in total. Paid apps are coming.`,
    );
  },
});

export async function completePaidRequest({
  options,
  interactive,
}: {
  options: InferOptions<typeof command.options>;
  interactive: boolean;
}): Promise<PaidRequest> {
  const supplied = Object.fromEntries(
    Object.entries(options).filter(function provided([, value]) {
      return value !== undefined;
    }),
  );
  if (
    options.type === PAID_REQUEST_TYPE_SCHEMA.enum.apps &&
    options[REQUESTED_APPS_AMOUNT_FLAG] === undefined
  ) {
    supplied[REQUESTED_APPS_AMOUNT_FLAG] = await requestedAppsAmount(interactive);
  }
  const parsed = PaidRequestOptionsSchema.safeParse(supplied);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map(function describeIssue(issue) {
        return issue.message;
      })
      .join('; ');
    throw new UsageError(`Invalid options for --type ${options.type}: ${reason}`);
  }
  return {
    requestType: parsed.data.type,
    requestedAppsAmount: parsed.data[REQUESTED_APPS_AMOUNT_FLAG],
  };
}

async function requestedAppsAmount(interactive: boolean): Promise<number> {
  if (!interactive) {
    throw new UsageError(
      `Pass --${REQUESTED_APPS_AMOUNT_FLAG} with the total you need: ${PROGRAM_NAME} paid-request --type ${PAID_REQUEST_TYPE_SCHEMA.enum.apps} --${REQUESTED_APPS_AMOUNT_FLAG} <${MIN_PAID_APPS_REQUEST}-${MAX_PAID_APPS_REQUEST}>.`,
    );
  }
  const value = answered(
    await text({ message: REQUEST_LABELS.apps.question, validate: validateAmount }),
  );
  return REQUESTED_APPS_AMOUNT_SCHEMA.parse(Number(value));
}

function validateAmount(value: string | undefined): string | undefined {
  return REQUESTED_APPS_AMOUNT_SCHEMA.safeParse(Number(value)).success
    ? undefined
    : `Enter a whole number from ${MIN_PAID_APPS_REQUEST} to ${MAX_PAID_APPS_REQUEST}.`;
}
