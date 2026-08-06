import { beforeEach, expect, mock, test } from 'bun:test';
import type { Api } from '#lib/api.ts';

const asked: string[] = [];
const notes: string[] = [];
let chosenApp: unknown = null;
let confirmed: boolean = true;

// Stubbed at the module rather than behind an injected port: what is being pinned down is which
// questions get asked and in what order, and a port would only let this file answer that about
// itself.
mock.module('@clack/prompts', () => ({
  isCancel: (value: unknown) => typeof value === 'symbol',
  select(opts: { message: string; options: Array<{ label: string }> }) {
    asked.push(`select:${opts.message} [${opts.options.map((option) => option.label).join('|')}]`);
    return Promise.resolve(chosenApp);
  },
  text(opts: { message: string; initialValue?: string }) {
    asked.push(`text:${opts.message} (${opts.initialValue})`);
    return Promise.resolve(opts.initialValue);
  },
  confirm(opts: { message: string }) {
    asked.push(`confirm:${opts.message}`);
    return Promise.resolve(confirmed);
  },
  // biome-ignore lint/complexity/useMaxParams: mirrors clack's own (message, title) signature
  note(message: string, title: string) {
    notes.push(`${title}\n${message}`);
  },
}));

const { completeOptions } = await import('#lib/plan.ts');

beforeEach(() => {
  asked.length = 0;
  notes.length = 0;
  chosenApp = null;
  confirmed = true;
});

function apiListing(apps: Array<{ slug: string; state: string }>): Api {
  return {
    api: { apps: { get: () => Promise.resolve({ data: { apps }, error: null }) } },
  } as unknown as Api;
}

test('an owner with no apps is asked what to call one, not which to use', async () => {
  const resolved = await completeOptions({
    api: apiListing([]),
    options: {},
    binaryPath: '/tmp/my-server',
    args: ['serve'],
  });

  expect(resolved).toEqual({ name: 'my-server', port: 3000 });
  expect(asked).toEqual([
    'text:Name the app (my-server)',
    'text:Which port does the binary listen on? (3000)',
    'confirm:Create my-server and deploy?',
  ]);
});

test('an app the owner cannot deploy onto is not offered', async () => {
  chosenApp = 'demo-abc123';

  const resolved = await completeOptions({
    api: apiListing([
      { slug: 'demo-abc123', state: 'active' },
      { slug: 'gone-xyz789', state: 'deleted' },
    ]),
    options: {},
    binaryPath: '/tmp/my-server',
    args: [],
  });

  expect(resolved).toEqual({ app: 'demo-abc123' });
  expect(asked).toEqual([
    'select:Deploy onto which app? [A new app|demo-abc123]',
    'confirm:Deploy onto demo-abc123? This replaces what it is running.',
  ]);
});

test('a flag already given is not asked about again', async () => {
  const resolved = await completeOptions({
    api: apiListing([{ slug: 'demo-abc123', state: 'active' }]),
    options: { app: 'demo-abc123', vcpu: 2 },
    binaryPath: '/tmp/my-server',
    args: ['serve', '--verbose'],
  });

  expect(resolved).toEqual({ app: 'demo-abc123', vcpu: 2 });
  expect(asked).toEqual(['confirm:Deploy onto demo-abc123? This replaces what it is running.']);
});

test('what the binary will be run with is shown before anything is uploaded', async () => {
  await completeOptions({
    api: apiListing([{ slug: 'demo-abc123', state: 'active' }]),
    options: { app: 'demo-abc123' },
    binaryPath: '/tmp/my-server',
    args: ['serve', '--verbose'],
  });

  expect(notes.at(-1)).toContain('args: serve --verbose');
  expect(notes.at(-1)).toContain('binary: /tmp/my-server');
});

test('declining the confirmation cancels rather than deploying', async () => {
  confirmed = false;

  const attempt = completeOptions({
    api: apiListing([]),
    options: {},
    binaryPath: '/tmp/my-server',
    args: [],
  });

  await expect(attempt).rejects.toThrow('Cancelled.');
});
