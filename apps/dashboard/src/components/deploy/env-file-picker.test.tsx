import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { EnvFilePicker } from '#components/deploy/env-file-picker.tsx';

function ignoreLoadedEnvironment(): void {}

describe('environment file picker', () => {
  test('lets the native picker select suffixed dotenv files', () => {
    const markup = renderToStaticMarkup(<EnvFilePicker onLoad={ignoreLoadedEnvironment} />);

    expect(markup).toContain('type="file"');
    expect(markup).not.toContain('accept=');
  });
});
