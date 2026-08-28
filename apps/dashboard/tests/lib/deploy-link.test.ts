import { expect, test } from 'bun:test';
import { RUNTIME_VALUES, writtenRuntimeValue } from '@repo/protocol';
import { defaultParseSearch, defaultStringifySearch } from '@tanstack/react-router';
import {
  type DeployLink,
  type DeploySuggestion,
  deployLink,
  deploySuggestion,
} from '#lib/deploy-link.ts';

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

function written(link: string): DeployLink {
  return deployLink(defaultParseSearch(link));
}

function followed(link: string): DeploySuggestion {
  return deploySuggestion(written(link));
}

/**
 * The link as the router writes it back, which is what the address bar holds the moment the page
 * navigates — following the ghost button out of the minimal form, or coming back through signing
 * in. Whatever a link asked for has to survive being written by the router that read it.
 */
function rewritten(link: string): string {
  return defaultStringifySearch(written(link));
}

/**
 * The binary is not part of what a deploy configures — it is what is deployed — so a link carrying
 * one is the difference between a form to fill in and a button to press.
 */
test('a link may carry the binary itself', () => {
  expect(followed('?binary=https://releases.test/v1/my-server').binary).toBe(
    'https://releases.test/v1/my-server',
  );
  expect(followed(rewritten('?binary=https://releases.test/v1/my-server')).binary).toBe(
    'https://releases.test/v1/my-server',
  );
});

test('a url nibrun could not fetch a binary from prefills nothing', () => {
  expect(followed('?binary=http://releases.test/v1/my-server').binary).toBeUndefined();
  expect(followed('?binary=https://releases.test/downloads/').binary).toBeUndefined();
});

test('a link may ask for everything a deploy configures', () => {
  expect(followed(EVERYTHING)).toEqual(ASKED);
});

test('and asks for the same once the router has written it back', () => {
  expect(followed(rewritten(EVERYTHING))).toEqual(ASKED);
  expect(rewritten(rewritten(EVERYTHING))).toBe(rewritten(EVERYTHING));
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
  const link = '?env=CONFIG={"port":1}';
  expect(followed(rewritten(link)).environment).toEqual([{ name: 'CONFIG', value: '{"port":1}' }]);
});

test('a flag is on where it is written at all', () => {
  expect(followed('?extra-public-port').extraPublicPort).toBe(true);
  expect(followed(rewritten('?extra-public-port')).extraPublicPort).toBe(true);
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
    binary: undefined,
    port: undefined,
    extraPublicPort: undefined,
    args: undefined,
    environment: undefined,
  });
});

test('a link may ask for the form stripped to the binary', () => {
  expect(written('?minimal').minimal).toBe(true);
  expect(written(`${EVERYTHING}&minimal`).minimal).toBe(true);
  expect(written('?minimal=false').minimal).toBe(false);
  expect(written(EVERYTHING).minimal).toBeUndefined();
});

// What the ghost button does: the parameter that stripped the form goes, and the deploy the link
// asked for is still every bit of what the form is holding.
test('and the rest of it survives that parameter going', () => {
  const stripped = written(`${EVERYTHING}&minimal`);
  const configured = defaultStringifySearch({ ...stripped, minimal: undefined });

  expect(written(configured).minimal).toBeUndefined();
  expect(followed(configured)).toEqual(ASKED);
});
