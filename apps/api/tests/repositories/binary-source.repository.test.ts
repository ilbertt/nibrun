import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { TCPSocketListener } from 'bun';
import {
  type BinarySource,
  BinarySourceRepository,
  InterruptedSourceError,
} from '#repositories/binary-source.repository.ts';

const BINARY = 'a binary, as far as a source is concerned';
// A chunked body sizes each chunk in hex, which is the one part of writing one out by hand.
const HEX = 16;

/**
 * Answered by a real server rather than a fake handing over a `ReadableStream`, because what is
 * worth testing here is the part nibrun does not run: a header a host omits, a redirect it answers
 * with, and a body that stops arriving. None of those are things a stand-in can be wrong about.
 */
let releases: ReturnType<typeof Bun.serve>;
let byHand: TCPSocketListener;
const repo = new BinarySourceRepository();

beforeAll(() => {
  releases = Bun.serve({ port: 0, fetch: answer });
  byHand = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data: answerByHand } });
});

afterAll(() => {
  releases.stop(true);
  byHand.stop(true);
});

function at(path: string): string {
  return new URL(path, releases.url).toString();
}

function answer(request: Request): Response {
  switch (new URL(request.url).pathname) {
    case '/my-server':
      return new Response(BINARY);
    case '/elsewhere':
      return new Response(null, { status: 302, headers: { location: '/my-server' } });
    default:
      return new Response('no such release', { status: 404 });
  }
}

// Written onto the socket rather than served, because what these two answers are is what a server
// framework decides for itself: `Bun.serve` measures a body it can measure, and a length is what
// one of these is about not having.
function byHandAt(path: string): string {
  return `http://127.0.0.1:${byHand.port}${path}`;
}

// biome-ignore lint/complexity/useMaxParams: the shape a socket handler is called with
function answerByHand(socket: Bun.Socket, data: Buffer): void {
  const chunked = data.toString().startsWith('GET /chunked');
  socket.write(
    chunked
      ? `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${BINARY.length.toString(HEX)}\r\n${BINARY}\r\n0\r\n\r\n`
      : // Promises more than it sends and then hangs up, which is what a download interrupted part
        // way through looks like from this end.
        `HTTP/1.1 200 OK\r\nContent-Length: ${BINARY.length * 2}\r\n\r\n${BINARY}`,
  );
  if (!chunked) {
    socket.end();
  }
}

async function read(source: BinarySource): Promise<string> {
  if (source.outcome !== 'open') {
    throw new Error(`the source was ${source.outcome}`);
  }
  return await new Response(source.body).text();
}

describe('a url is opened, and what it answers with is what it is', () => {
  test('a body is handed over with the length its host declared', async () => {
    const source = await repo.open({ url: at('/my-server') });

    expect(source).toMatchObject({ outcome: 'open', declaredSizeBytes: BINARY.length });
    expect(await read(source)).toBe(BINARY);
  });

  // A host that says nothing about its length has not said zero, and reading it as zero would make
  // every chunked release look like an empty one to whoever asks next.
  test('a host that declares no length declares nothing, not nothing much', async () => {
    const source = await repo.open({ url: byHandAt('/chunked') });

    expect(source).toMatchObject({ outcome: 'open', declaredSizeBytes: undefined });
    expect(await read(source)).toBe(BINARY);
  });

  test('a status is that status, not a nibrun failure', async () => {
    expect(await repo.open({ url: at('/gone') })).toEqual({ outcome: 'refused', status: 404 });
  });

  test('a host nothing is listening on is unreachable rather than an error to read back', async () => {
    expect(await repo.open({ url: 'https://not.a.host.nibrun.test/my-server' })).toEqual({
      outcome: 'unreachable',
    });
  });
});

/**
 * The https rule is what makes the api the only thing standing between the store and the guest, and
 * a rule applied to the address that was typed alone is one a redirect walks straight around.
 */
describe('every hop is held to the rule the first one was', () => {
  test('a redirect out of https is refused, and says where it pointed', async () => {
    expect(await repo.open({ url: at('/elsewhere') })).toEqual({
      outcome: 'insecure-redirect',
      to: at('/my-server'),
    });
  });
});

describe('a source that stops part way is the url, not the api', () => {
  test('the body errors as the source having gone rather than as a read that failed', async () => {
    const source = await repo.open({ url: byHandAt('/cut-off') });

    await expect(read(source)).rejects.toBeInstanceOf(InterruptedSourceError);
  });
});
