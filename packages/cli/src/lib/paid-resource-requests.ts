import { text } from '@clack/prompts';
import type { PaidRequest } from '@repo/api-client/models';
import { MAX_PAID_RESOURCE_AMOUNT } from '@repo/api-constants';
import { z } from 'zod';
import { UsageError } from '#lib/errors.ts';
import { answered } from '#lib/prompts.ts';

export const ADDITIONAL_VCPU_COUNT_FLAG = 'additional-vcpu-count';
export const ADDITIONAL_MEMORY_MIB_FLAG = 'additional-memory-mib';
export const ADDITIONAL_VOLUME_GIB_FLAG = 'additional-volume-gib';

const AdditionalResourceAmountSchema = z.number().int().min(0).max(MAX_PAID_RESOURCE_AMOUNT);

export const PAID_RESOURCE_OPTIONS_SCHEMA = z.object({
  [ADDITIONAL_VCPU_COUNT_FLAG]: AdditionalResourceAmountSchema.optional(),
  [ADDITIONAL_MEMORY_MIB_FLAG]: AdditionalResourceAmountSchema.optional(),
  [ADDITIONAL_VOLUME_GIB_FLAG]: AdditionalResourceAmountSchema.optional(),
});

export const PAID_RESOURCE_AMOUNTS_SCHEMA = z
  .object({
    additionalVcpuCount: AdditionalResourceAmountSchema,
    additionalMemoryMib: AdditionalResourceAmountSchema,
    additionalVolumeGib: AdditionalResourceAmountSchema,
  })
  .refine((amounts) => Object.values(amounts).some((amount) => amount > 0), {
    error: 'Request an increase for at least one resource.',
  });

type PaidResourceAmounts = Omit<
  Extract<PaidRequest, { requestType: 'resources' }>,
  'requestType' | 'appId'
>;

export async function completePaidResourceAmounts({
  options,
  interactive,
}: {
  options: z.infer<typeof PAID_RESOURCE_OPTIONS_SCHEMA>;
  interactive: boolean;
}): Promise<PaidResourceAmounts> {
  const amounts = {
    additionalVcpuCount: options[ADDITIONAL_VCPU_COUNT_FLAG],
    additionalMemoryMib: options[ADDITIONAL_MEMORY_MIB_FLAG],
    additionalVolumeGib: options[ADDITIONAL_VOLUME_GIB_FLAG],
  };
  const shouldPrompt =
    interactive && Object.values(amounts).every((amount) => amount === undefined);
  const parsed = PAID_RESOURCE_AMOUNTS_SCHEMA.safeParse({
    additionalVcpuCount: shouldPrompt
      ? await promptAdditionalAmount('How many additional vCPUs do you need?')
      : (amounts.additionalVcpuCount ?? 0),
    additionalMemoryMib: shouldPrompt
      ? await promptAdditionalAmount('How much additional RAM do you need (MiB)?')
      : (amounts.additionalMemoryMib ?? 0),
    additionalVolumeGib: shouldPrompt
      ? await promptAdditionalAmount('How much additional volume do you need (GiB)?')
      : (amounts.additionalVolumeGib ?? 0),
  });
  if (!parsed.success) {
    throw new UsageError(
      `Pass --${ADDITIONAL_VCPU_COUNT_FLAG}, --${ADDITIONAL_MEMORY_MIB_FLAG}, or --${ADDITIONAL_VOLUME_GIB_FLAG} with a positive amount. Omitted amounts are 0.`,
    );
  }
  return parsed.data;
}

async function promptAdditionalAmount(message: string): Promise<number> {
  return Number(
    answered(
      await text({
        message,
        defaultValue: '0',
        placeholder: '0',
        validate: validateAdditionalAmount,
      }),
    ),
  );
}

function validateAdditionalAmount(value: string | undefined): string | undefined {
  return AdditionalResourceAmountSchema.safeParse(Number(value)).success
    ? undefined
    : `Enter a whole number from 0 to ${MAX_PAID_RESOURCE_AMOUNT}.`;
}
