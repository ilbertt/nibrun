import { text } from '@clack/prompts';
import type { PaidRequestType } from '@repo/api-client/models';
import { MAX_PAID_APPS_REQUEST, MIN_PAID_APPS_REQUEST } from '@repo/api-constants';
import { z } from 'zod';
import { PROGRAM_NAME } from '#config.ts';
import { UsageError } from '#lib/errors.ts';
import { defineOutput } from '#lib/output.ts';
import { answered } from '#lib/prompts.ts';

const REQUEST_LABELS = {
  apps: { question: 'How many apps do you need in total?', unit: 'app' },
} satisfies Record<PaidRequestType, { question: string; unit: string }>;

export const PAID_REQUEST_TYPE_SCHEMA = z.custom<PaidRequestType>(
  function supportedType(value) {
    return typeof value === 'string' && Object.hasOwn(REQUEST_LABELS, value);
  },
  `Supported paid request types: ${Object.keys(REQUEST_LABELS).join(', ')}.`,
);

export const PAID_REQUEST_AMOUNT_SCHEMA = z
  .number()
  .int()
  .min(MIN_PAID_APPS_REQUEST)
  .max(MAX_PAID_APPS_REQUEST);

export const PAID_REQUEST_HINT = `Run \`${PROGRAM_NAME} paid-request apps\` to tell us, or pass \`--amount <total>\` in scripts.`;

export const PAID_REQUEST_OUTPUT = defineOutput({
  schema: z.object({
    requestType: PAID_REQUEST_TYPE_SCHEMA,
    requestedAppsAmount: PAID_REQUEST_AMOUNT_SCHEMA,
  }),
  render: function renderRequest({ value, out }) {
    const { requestType, requestedAppsAmount } = value;
    const unit = REQUEST_LABELS[requestType].unit;
    out.success(
      `Thanks! We recorded your request for ${requestedAppsAmount} ${unit}${requestedAppsAmount === 1 ? '' : 's'} in total. Paid apps are coming.`,
    );
  },
});

export async function requestedPaidAmount({
  amount,
  requestType,
  interactive,
}: {
  amount: number | undefined;
  requestType: PaidRequestType;
  interactive: boolean;
}): Promise<number> {
  if (amount !== undefined) {
    return PAID_REQUEST_AMOUNT_SCHEMA.parse(amount);
  }
  if (!interactive) {
    throw new UsageError(
      `Pass --amount with the total you need: ${PROGRAM_NAME} paid-request ${requestType} --amount <${MIN_PAID_APPS_REQUEST}-${MAX_PAID_APPS_REQUEST}>.`,
    );
  }
  const value = answered(
    await text({ message: REQUEST_LABELS[requestType].question, validate: validateAmount }),
  );
  return PAID_REQUEST_AMOUNT_SCHEMA.parse(Number(value));
}

function validateAmount(value: string | undefined): string | undefined {
  return PAID_REQUEST_AMOUNT_SCHEMA.safeParse(Number(value)).success
    ? undefined
    : `Enter a whole number from ${MIN_PAID_APPS_REQUEST} to ${MAX_PAID_APPS_REQUEST}.`;
}
