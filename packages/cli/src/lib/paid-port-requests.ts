import { text } from '@clack/prompts';
import { MAX_PAID_PORTS_REQUEST, MIN_PAID_PORTS_REQUEST } from '@repo/api-constants';
import { z } from 'zod';
import { UsageError } from '#lib/errors.ts';
import { answered } from '#lib/prompts.ts';

export const REQUESTED_PORTS_AMOUNT_FLAG = 'requested-ports-amount';
export const REQUESTED_PORTS_AMOUNT_SCHEMA = z
  .number()
  .int()
  .min(MIN_PAID_PORTS_REQUEST)
  .max(MAX_PAID_PORTS_REQUEST);

export async function completePaidPortAmount({
  amount,
  interactive,
}: {
  amount: number | undefined;
  interactive: boolean;
}): Promise<number> {
  if (amount !== undefined) {
    return amount;
  }
  if (!interactive) {
    throw new UsageError(
      `Pass --${REQUESTED_PORTS_AMOUNT_FLAG} with the total number of extra ports you need.`,
    );
  }
  const value = answered(
    await text({
      message: 'How many extra public ports do you need for this app?',
      defaultValue: String(MIN_PAID_PORTS_REQUEST),
      validate: validateAmount,
    }),
  );
  return REQUESTED_PORTS_AMOUNT_SCHEMA.parse(Number(value));
}

function validateAmount(value: string | undefined): string | undefined {
  return REQUESTED_PORTS_AMOUNT_SCHEMA.safeParse(Number(value)).success
    ? undefined
    : `Enter a whole number from ${MIN_PAID_PORTS_REQUEST} to ${MAX_PAID_PORTS_REQUEST}.`;
}
