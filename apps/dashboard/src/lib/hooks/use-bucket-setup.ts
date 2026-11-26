import type { AppPatch } from '@repo/api-client/models';
import { unwrap } from '@repo/api-client/unwrap';
import { useState } from 'react';
import { api } from '#lib/api.ts';
import { useAppId } from '#lib/hooks/use-app-id.ts';

type BucketConfig = NonNullable<NonNullable<AppPatch['config']>['volumeStorage']>;
type Setup = Awaited<ReturnType<typeof prepareSetup>>;

async function prepareSetup({ appId, storage }: { appId: string; storage: BucketConfig }) {
  return unwrap(await api.api.apps({ appId })['bucket-setup'].post(storage));
}

function readConfig({
  form,
  kind,
}: {
  form: HTMLFormElement;
  kind: BucketConfig['auth']['kind'];
}): BucketConfig {
  const data = new FormData(form);
  function field(name: string) {
    return String(data.get(name) ?? '');
  }
  const region = field('region').trim();
  const credentials = {
    accessKeyId: field('accessKeyId'),
    secretAccessKey: field('secretAccessKey'),
  };
  function auth(): BucketConfig['auth'] {
    if (kind === 'anonymous') {
      return { kind };
    }
    if (kind === 'session') {
      return { kind, ...credentials, sessionToken: field('sessionToken') };
    }
    return { kind, ...credentials };
  }
  return {
    endpoint: field('endpoint').trim(),
    bucket: field('bucket').trim(),
    ...(region && { region }),
    auth: auth(),
    encryptionPassword: field('encryptionPassword'),
  };
}

type BucketSetupFormState = {
  kind: BucketConfig['auth']['kind'];
  changeKind: (kind: string) => void;
  setup: Setup | undefined;
  startAgain: () => void;
  error: string;
  pending: boolean;
  prepare: (form: HTMLFormElement) => Promise<void>;
};
export function useBucketSetup(): BucketSetupFormState {
  const appId = useAppId();
  const [kind, setKind] = useState<BucketConfig['auth']['kind']>('access-key');
  const [setup, setSetup] = useState<Setup>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function prepare(form: HTMLFormElement) {
    setPending(true);
    setError('');
    try {
      const prepared = await prepareSetup({ appId, storage: readConfig({ form, kind }) });
      form.reset();
      setSetup(prepared);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare this bucket.');
    } finally {
      setPending(false);
    }
  }

  return {
    kind,
    setup,
    pending,
    error,
    prepare,
    startAgain: () => setSetup(undefined),
    changeKind: (value) => {
      if (value === 'access-key' || value === 'anonymous' || value === 'session') {
        setKind(value);
      }
    },
  };
}
