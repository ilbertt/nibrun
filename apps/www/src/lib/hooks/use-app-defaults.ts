import type { Configuration } from '@repo/api-client/models';
import { unwrap } from '@repo/api-client/unwrap';
import { useEffect, useState } from 'react';
import { api } from '#lib/api.ts';

type AppDefaults = Configuration['appDefaults'];

export function useAppDefaults(): AppDefaults | undefined {
  const [defaults, setDefaults] = useState<AppDefaults>();
  useEffect(() => {
    const controller = new AbortController();
    api.api.configuration
      .get({ fetch: { signal: controller.signal } })
      .then((reply) => setDefaults(unwrap(reply).appDefaults))
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return defaults;
}
