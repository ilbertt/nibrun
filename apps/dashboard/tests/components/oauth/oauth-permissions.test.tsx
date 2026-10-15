import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { OAuthPermissions } from '#components/oauth/oauth-permissions.tsx';

test('consent explains only the requested permissions', () => {
  const markup = renderToStaticMarkup(<OAuthPermissions scopes={['mcp']} />);
  expect(markup).toContain('Access your nibrun apps.');
  expect(markup).not.toContain('Keep this connection active');
});

test('offline access is explained separately from MCP access', () => {
  const markup = renderToStaticMarkup(<OAuthPermissions scopes={['offline_access']} />);
  expect(markup).toContain('Keep this connection active when you are away.');
  expect(markup).not.toContain('Access your nibrun apps');
});

test('additional scope names are rendered as text', () => {
  const markup = renderToStaticMarkup(<OAuthPermissions scopes={['<script>scope</script>']} />);
  expect(markup).toContain('&lt;script&gt;scope&lt;/script&gt;');
  expect(markup).not.toContain('<script>');
});
