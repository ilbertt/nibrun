import { expect, test } from 'bun:test';
import { StatusMap } from 'elysia';
import {
  DEFAULT_HTTP_PORT,
  DEFAULT_INSTANCE_RESOURCES,
  DEFAULT_VOLUME_SIZE_BYTES,
} from '#lib/app-config-defaults.ts';
import { EXTRA_PUBLIC_PORT_VALUES, RUNTIME_VALUES } from '#lib/runtime-values.ts';
import { ORIGIN, send } from '#tests/controllers/support/api.ts';

test('public configuration exposes canonical defaults and runtime metadata without authentication', async () => {
  const response = await send({ url: `${ORIGIN}/api/configuration` });
  expect(response.status).toBe(StatusMap.OK);
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
  expect(await response.json()).toEqual({
    appDefaults: {
      httpPort: DEFAULT_HTTP_PORT,
      resources: DEFAULT_INSTANCE_RESOURCES,
      volumeSizeBytes: DEFAULT_VOLUME_SIZE_BYTES,
    },
    runtimeValues: Object.values(RUNTIME_VALUES).map((value) => ({
      ...value,
      requiresExtraPublicPort: EXTRA_PUBLIC_PORT_VALUES.some(
        (portValue) => portValue.name === value.name,
      ),
    })),
  });
});
