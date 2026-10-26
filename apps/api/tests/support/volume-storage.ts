import { Value } from '@sinclair/typebox/value';
import { type CreateVolumeStorage, CreateVolumeStorageSchema } from '#lib/api/volume-storage.ts';

export function volumeStorageInput(
  overrides: Partial<CreateVolumeStorage> = {},
): CreateVolumeStorage {
  return Value.Parse(CreateVolumeStorageSchema, {
    endpoint: 'https://objects.example.test',
    bucket: 'customer-bucket',
    auth: { kind: 'access-key', accessKeyId: 'access', secretAccessKey: 'access-secret-private' },
    encryptionPassword: 'filesystem-password-private',
    ...overrides,
  });
}

export function volumeStorageInputs(): CreateVolumeStorage[] {
  return [
    volumeStorageInput(),
    Value.Parse(CreateVolumeStorageSchema, {
      ...volumeStorageInput(),
      region: 'auto',
      auth: {
        kind: 'session',
        accessKeyId: 'access',
        secretAccessKey: 'access-secret-private',
        sessionToken: 'session-token-private',
      },
    }),
    volumeStorageInput({ auth: { kind: 'anonymous' } }),
  ];
}
