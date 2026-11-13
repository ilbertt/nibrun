import { describe, expect, test } from 'bun:test';
import { useForm } from '@tanstack/react-form';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  DeployFormApi,
  DeployFormState,
  DeployFormValues,
} from '#lib/hooks/use-deploy-form.ts';
import type { AppSummary } from '#queries/apps.ts';

const INITIAL_DATA = 'Initial data';
const PORT = '8080';

/**
 * The api client is built against the origin it is same-origin with as it is imported, and the form
 * reaches it through the hooks it shares with the rest of the deploy. So the origin is there before
 * the component is, which is what the dynamic import below is for.
 */
Object.defineProperty(globalThis, 'window', {
  value: { location: { origin: 'https://app.nibrun.com' } },
});

const { DeployConfiguration } = await import('#components/deploy/deploy-configuration.tsx');

const UNTOUCHED: DeployFormValues = {
  binary: undefined,
  name: '',
  port: undefined,
  args: undefined,
  environment: undefined,
  initialData: undefined,
};

// Cast because what this file is about is which fields the form offers, not what an app row holds.
const RUNNING = { config: { args: [], environment: [] } } as unknown as AppSummary;

/** The form as this file needs it: a real api, and around it what the hook would have read. */
function Configuration({ replacing }: { replacing: AppSummary | undefined }) {
  const api: DeployFormApi = useForm({ defaultValues: UNTOUCHED });
  const form: DeployFormState = {
    api,
    binaryListeners: {},
    locked: replacing !== undefined,
    replacing,
    targetResolved: true,
    defaultPort: PORT,
    defaultArgs: '',
  };

  return <DeployConfiguration form={form} suggested={undefined} />;
}

describe('what a deploy is beyond the binary itself', () => {
  test('an app being created is offered the data its filesystem starts as', () => {
    const markup = renderToStaticMarkup(<Configuration replacing={undefined} />);

    expect(markup).toContain(INITIAL_DATA);
    expect(markup).toContain('.tar.gz');
    expect(markup).toContain('.zip');
  });

  /**
   * An app's data is created once, along with the app: the api refuses an import against a volume a
   * host has already reported ready, so a release onto an app that exists has nowhere to put one —
   * and a field only ever answered with a 409 is worse than no field.
   */
  test('an app that already has one is not asked for it again', () => {
    const markup = renderToStaticMarkup(<Configuration replacing={RUNNING} />);

    expect(markup).not.toContain(INITIAL_DATA);
    expect(markup).toContain('Environment variables');
  });
});

test('extra ports cannot be configured in the deploy form', () => {
  const markup = renderToStaticMarkup(<Configuration replacing={undefined} />);
  expect(markup).not.toContain('Additional ports');
  expect(markup).not.toContain('deploy-extra-public-port');
});

test('remote initial data is validated as an HTTPS URL rather than as an uploaded file', async () => {
  const { validateInitialData } = await import('#lib/hooks/use-deploy-form.ts');
  expect(
    await validateInitialData({ value: { url: 'https://releases.test/data.zip' } }),
  ).toBeUndefined();
  expect(
    await validateInitialData({ value: { url: 'http://releases.test/data.zip' } }),
  ).toBeDefined();
  expect(await validateInitialData({ value: new File(['invalid'], 'data.zip') })).toContain(
    'not a .tar.gz or a .zip',
  );
});

test('a remote archive is displayed in the initial data URL field', async () => {
  const { InitialDataSourcePicker } = await import(
    '#components/deploy/initial-data-source-picker.tsx'
  );
  const url = 'https://releases.test/data.tar.gz';
  const markup = renderToStaticMarkup(
    <InitialDataSourcePicker value={{ url }} invalid={false} onChange={() => undefined} />,
  );
  expect(markup).toContain('Initial data archive url');
  expect(markup).toContain(url);
  expect(markup).toContain('Upload an archive');
});
