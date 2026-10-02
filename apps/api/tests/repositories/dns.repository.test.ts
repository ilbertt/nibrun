import { afterAll, beforeAll, expect, test } from 'bun:test';
import { DnsRepository } from '#repositories/dns.repository.ts';

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

function targets(response: unknown): Promise<string[]> {
  body = response;
  return new DnsRepository({ endpoint: server.url.href }).cnameTargets({
    hostname: 'app.example.dev',
  });
}

test('queries CNAME using DNS JSON and only accepts answers owned by the queried name', async () => {
  const result = await targets({
    Status: 0,
    Answer: [
      { name: 'APP.EXAMPLE.DEV.', type: 5, data: 'First.Example.com.' },
      { name: 'first.example.com.', type: 5, data: 'expected.example.com.' },
      { name: 'app.example.dev.', type: 1, data: '192.0.2.1' },
    ],
  });
  expect(result).toEqual(['first.example.com']);
  expect(requested.searchParams.get('name')).toBe('app.example.dev');
  expect(requested.searchParams.get('type')).toBe('CNAME');
  expect(accept).toBe('application/dns-json');
});

test('NXDOMAIN and a successful empty answer mean no visible CNAME', async () => {
  expect(await targets({ Status: 3 })).toEqual([]);
  expect(await targets({ Status: 0 })).toEqual([]);
});

test('SERVFAIL, truncation, malformed JSON data and HTTP failure are not missing records', async () => {
  for (const response of [
    { Status: 2 },
    { Status: 0, TC: true },
    { error: 'invalid' },
    { Status: 0, Answer: [{ name: 'app.example.dev.', type: 5, data: null }] },
  ]) {
    await expect(targets(response)).rejects.toThrow();
  }
  httpStatus = HTTP_UNAVAILABLE;
  try {
    await expect(targets({ Status: 0 })).rejects.toThrow('HTTP 503');
  } finally {
    httpStatus = HTTP_OK;
  }
});
