import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { CloudflareDnsClient } from '#lib/cloudflare-dns/client.ts';
import { CNAME_RECORD_TYPE } from '#lib/dns-records.ts';

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;

let body: unknown;
let httpStatus = HTTP_OK;
let requested: URL;
let accept: string | null;

function answer(...args: Parameters<typeof fetch>): ReturnType<typeof fetch> {
  const [input, init] = args;
  const request = new Request(input as string, init);
  requested = new URL(request.url);
  accept = request.headers.get('accept');
  return Promise.resolve(Response.json(body, { status: httpStatus }));
}

afterEach(() => {
  mock.restore();
  httpStatus = HTTP_OK;
});

function answers(response: unknown): ReturnType<CloudflareDnsClient['queryCname']> {
  body = response;
  spyOn(globalThis, 'fetch').mockImplementation(answer as typeof fetch);
  return new CloudflareDnsClient().queryCname({ hostname: 'app.example.dev' });
}

test('queries CNAME using DNS JSON and returns validated answers', async () => {
  const answer = {
    name: 'APP.EXAMPLE.DEV.',
    type: CNAME_RECORD_TYPE.code,
    data: 'First.Example.com.',
  };
  expect(await answers({ Status: 0, Answer: [answer] })).toEqual([answer]);
  expect(requested.searchParams.get('name')).toBe('app.example.dev');
  expect(requested.searchParams.get('type')).toBe(CNAME_RECORD_TYPE.name);
  expect(accept).toBe('application/dns-json');
});

test('NXDOMAIN and a successful empty answer mean no visible CNAME', async () => {
  expect(await answers({ Status: 3 })).toEqual([]);
  expect(await answers({ Status: 0 })).toEqual([]);
});

test('SERVFAIL, truncation, malformed JSON data and HTTP failure are not missing records', async () => {
  for (const response of [
    { Status: 2 },
    { Status: 0, TC: true },
    { error: 'invalid' },
    { Status: 0, Answer: [{ name: 'app.example.dev.', type: CNAME_RECORD_TYPE.code, data: null }] },
  ]) {
    await expect(answers(response)).rejects.toThrow();
  }
  httpStatus = HTTP_UNAVAILABLE;
  try {
    await expect(answers({ Status: 0 })).rejects.toThrow('HTTP 503');
  } finally {
    httpStatus = HTTP_OK;
  }
});
