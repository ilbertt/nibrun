import { expect, test } from 'bun:test';
import { isMcpLogin, mcpLoginErrorCode } from '#lib/mcp-login-analytics.ts';

const SIGNED_QUERY = '?client_id=mcp-client&sig=server-signature';

test('MCP login attribution requires the signed OAuth context on the page', () => {
  expect(isMcpLogin(SIGNED_QUERY)).toBe(true);
  for (const query of [
    '',
    '?redirect=%2Fapps',
    '?client_id=mcp-client',
    '?sig=signature',
    '?client_id=&sig=signature',
  ]) {
    expect(isMcpLogin(query)).toBe(false);
  }
});

test('OAuth callback errors retain only known codes, excluding arbitrary error details', () => {
  for (const code of ['access_denied', 'invalid_code', 'state_mismatch', 'INVALID_ORIGIN']) {
    expect(mcpLoginErrorCode(`${SIGNED_QUERY}&error=${code}`)).toBe(code);
  }
  for (const code of [
    'private@example.com',
    'https://private.test/?token=SECRET',
    '__proto__',
    'constructor',
  ]) {
    expect(mcpLoginErrorCode(`${SIGNED_QUERY}&error=${encodeURIComponent(code)}`)).toBeUndefined();
  }
  expect(mcpLoginErrorCode(SIGNED_QUERY)).toBeUndefined();
});
