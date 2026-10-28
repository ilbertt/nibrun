import { text } from '@clack/prompts';
import { MAX_PAID_RESOURCE_AMOUNT } from '@repo/api-constants';
import type { PaidResourceAmounts } from '@repo/app-operations';
import { z } from 'zod';
import { UsageError } from '#lib/errors.ts';
import { answered } from '#lib/prompts.ts';

export const REQUESTED_VCPU_COUNT_FLAG = 'requested-vcpu-count';
export const REQUESTED_MEMORY_MIB_FLAG = 'requested-memory-mib';
export const REQUESTED_VOLUME_GIB_FLAG = 'requested-volume-gib';

const RequestedResourceAmountSchema = z.number().int().min(1).max(MAX_PAID_RESOURCE_AMOUNT);

export const PAID_RESOURCE_OPTIONS_SCHEMA = z.object({
  [REQUESTED_VCPU_COUNT_FLAG]: RequestedResourceAmountSchema.optional(),
  [REQUESTED_MEMORY_MIB_FLAG]: RequestedResourceAmountSchema.optional(),
  [REQUESTED_VOLUME_GIB_FLAG]: RequestedResourceAmountSchema.optional(),
});

export const PAID_RESOURCE_AMOUNTS_SCHEMA = z.object({
  requestedVcpuCount: RequestedResourceAmountSchema,
  requestedMemoryMib: RequestedResourceAmountSchema,
  requestedVolumeGib: RequestedResourceAmountSchema,
});

export async function completePaidResourceAmounts({
  options,
  interactive,
  current,
}: {
  options: z.infer<typeof PAID_RESOURCE_OPTIONS_SCHEMA>;
  interactive: boolean;
  current: PaidResourceAmounts;
}): Promise<PaidResourceAmounts> {
  const amounts = {
    requestedVcpuCount: options[REQUESTED_VCPU_COUNT_FLAG],
    requestedMemoryMib: options[REQUESTED_MEMORY_MIB_FLAG],
    requestedVolumeGib: options[REQUESTED_VOLUME_GIB_FLAG],
  };
  const noAmounts = Object.values(amounts).every((amount) => amount === undefined);
  if (noAmounts && !interactive) {
    throw new UsageError(
      `Pass --${REQUESTED_VCPU_COUNT_FLAG}, --${REQUESTED_MEMORY_MIB_FLAG}, or --${REQUESTED_VOLUME_GIB_FLAG} with the total you need. Omitted resources keep their current allocation.`,
    );
  }
  const shouldPrompt = interactive && noAmounts;
  return PAID_RESOURCE_AMOUNTS_SCHEMA.parse({
    requestedVcpuCount: shouldPrompt
      ? await promptRequestedAmount({
          message: 'How many vCPUs do you need in total?',
          current: current.requestedVcpuCount,
        })
      : (amounts.requestedVcpuCount ?? current.requestedVcpuCount),
    requestedMemoryMib: shouldPrompt
      ? await promptRequestedAmount({
          message: 'How much RAM do you need in total (MiB)?',
          current: current.requestedMemoryMib,
        })
      : (amounts.requestedMemoryMib ?? current.requestedMemoryMib),
    requestedVolumeGib: shouldPrompt
      ? await promptRequestedAmount({
          message: 'How much volume do you need in total (GiB)?',
          current: current.requestedVolumeGib,
        })
      : (amounts.requestedVolumeGib ?? current.requestedVolumeGib),
  });
}

async function promptRequestedAmount({
  message,
  current,
}: {
  message: string;
  current: number;
}): Promise<number> {
  return Number(
    answered(
      await text({
        message,
        defaultValue: String(current),
        placeholder: String(current),
        validate: validateRequestedAmount,
      }),
    ),
  );
}

function validateRequestedAmount(value: string | undefined): string | undefined {
  return RequestedResourceAmountSchema.safeParse(Number(value)).success
    ? undefined
    : `Enter a whole number from 1 to ${MAX_PAID_RESOURCE_AMOUNT}.`;
}
