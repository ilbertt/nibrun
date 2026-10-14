import { spyOn } from 'bun:test';

type FetchHandler = (...args: Parameters<typeof fetch>) => Promise<Response>;

export function mockFetch(handler: FetchHandler) {
  return spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(handler, { preconnect: fetch.preconnect }),
  );
}
