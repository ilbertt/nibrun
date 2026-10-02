import { afterAll, beforeAll, expect, test } from 'bun:test';
import { CNAME_RECORD_TYPE } from '@repo/protocol';
import { CloudflareDnsClient } from '#lib/cloudflare-dns/client.ts';

const HTTP_OK = 200;
const HTTP_UNAVAILABLE = 503;

let server: ReturnType<typeof Bun.serve>;
let body: unknown;
let httpStatus = HTTP_OK;
let requested: URL;
let accept: string | null;

function answer(request: Request): Response {
  requested = new URL(request.url);
  accept = request.headers.get('accept');
  return Response.json(body, { status: httpStatus });
}

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: answer });
});
afterAll(() => {
  server.stop(true);
});

function answers(response: unknown): ReturnType<CloudflareDnsClient['queryCname']> {
  body = response;
  return new CloudflareDnsClient({ endpoint: server.url.href }).queryCname({
    hostname: 'app.example.dev',
  });
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
