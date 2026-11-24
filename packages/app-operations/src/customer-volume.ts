import type { CustomerVolumeStorage } from '@repo/api-client/models';

// The create-app endpoint owns the schema. Parser errors can quote input containing credentials.
export async function readCustomerVolume(file: Blob): Promise<CustomerVolumeStorage> {
  try {
    const value: unknown = JSON.parse(await file.text());
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return value as CustomerVolumeStorage;
    }
  } catch {
    throw new Error('Could not read the customer bucket configuration as a JSON object.');
  }
  throw new Error('The customer bucket configuration must contain a JSON object.');
}
