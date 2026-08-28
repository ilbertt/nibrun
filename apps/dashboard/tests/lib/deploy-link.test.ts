import { expect, test } from 'bun:test';
import { RUNTIME_VALUES, writtenRuntimeValue } from '@repo/protocol';
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import { type DeploySuggestion, deploySuggestion } from '#lib/deploy-link.ts';

const HOSTNAME = writtenRuntimeValue(RUNTIME_VALUES.HOSTNAME.name);

const EVERYTHING = `?name=my-app&port=9000&extra-public-port=true&arg=serve&arg=--verbose&env=API_KEY&env=GREETING=hello&env=URL=https://${HOSTNAME}`;

const ASKED: DeploySuggestion = {
  name: 'my-app',
  port: 9000,
  extraPublicPort: true,
  args: ['serve', '--verbose'],
  environment: [
    { name: 'API_KEY', value: '' },
    { name: 'GREETING', value: 'hello' },
    { name: 'URL', value: `https://${HOSTNAME}` },
  ],
};

function followed(link: string): DeploySuggestion {
  return deploySuggestion(defaultParseSearch(link));
}

/**
 * The link as the router writes it back, which is the form of it a sign-in carries: whoever
 * follows one while signed out reaches the form through a redirect holding this.
 */
function reopened(link: string): DeploySuggestion {
  return followed(defaultStringifySearch(defaultParseSearch(link)));
}

test('a link may ask for everything a deploy configures', () => {
  expect(followed(EVERYTHING)).toEqual(ASKED);
});

test('and asks for the same after the round trip through signing in', () => {
  expect(reopened(EVERYTHING)).toEqual(ASKED);
});

test('a repeatable parameter written once is that one thing', () => {
  expect(followed('?arg=serve&env=API_KEY')).toMatchObject({
    args: ['serve'],
    environment: [{ name: 'API_KEY', value: '' }],
  });
});

test('a runtime value survives however it was written into the link', () => {
  expect(followed(`?env=URL=${encodeURIComponent(HOSTNAME)}`).environment).toEqual([
    { name: 'URL', value: HOSTNAME },
  ]);
});

test('a value the router could read as JSON is still the text it was', () => {
  expect(reopened('?env=CONFIG={"port":1}').environment).toEqual([
    { name: 'CONFIG', value: '{"port":1}' },
  ]);
});

test('a flag is on where it is written at all', () => {
  expect(followed('?extra-public-port').extraPublicPort).toBe(true);
  expect(reopened('?extra-public-port').extraPublicPort).toBe(true);
  expect(followed('?extra-public-port=false').extraPublicPort).toBe(false);
});

test('a name given twice takes its last value', () => {
  expect(followed('?env=REGION=eu&env=REGION=us').environment).toEqual([
    { name: 'REGION', value: 'us' },
  ]);
});

test('a port that is no port is nothing to prefill', () => {
  expect(followed('?port=eight').port).toBeUndefined();
  expect(followed('?port=0').port).toBeUndefined();
});

test('a link that asks for nothing suggests nothing', () => {
  expect(followed('')).toEqual({
    name: undefined,
    port: undefined,
    extraPublicPort: undefined,
    args: undefined,
    environment: undefined,
  });
});
