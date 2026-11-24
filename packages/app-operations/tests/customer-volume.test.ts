import { expect, test } from 'bun:test';
import { readCustomerVolume } from '#customer-volume.ts';

test.each(['null', '[]', '"private-password"', '{"private-password":'])(
  'invalid bucket file %$ returns a safe error',
  async (text) => {
    await expect(readCustomerVolume(new Blob([text]))).rejects.toThrow(/JSON object/);
    await expect(readCustomerVolume(new Blob([text]))).rejects.not.toThrow('private-password');
  },
);
