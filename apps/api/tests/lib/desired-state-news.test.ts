import { describe, expect, test } from 'bun:test';
import { DesiredStateNews } from '#lib/agent/desired-state-news.ts';

const SESSION = 'session-of-record';
const OTHER_SESSION = 'another-host';

/** A hold that never expires on its own, so what resolves a wait is the news and only the news. */
const held = () => new AbortController().signal;

/** Whether the wait is over, asked without waiting on it: a poll still parked answers neither. */
function settled(waiting: Promise<void>): Promise<boolean> {
  return Promise.race([waiting.then(() => true), Promise.resolve().then(() => false)]);
}

describe('a host is answered at once when it is owed a read', () => {
  test('the first poll of a session is owed one, having heard nothing at all', async () => {
    const news = new DesiredStateNews();

    expect(await settled(news.awaited({ sessionToken: SESSION, signal: held() }))).toBe(true);
  });

  test('a session already told the current generation waits', async () => {
    const news = new DesiredStateNews();
    news.served({ sessionToken: SESSION, generation: news.generation });

    expect(await settled(news.awaited({ sessionToken: SESSION, signal: held() }))).toBe(false);
  });

  /** The case the hold exists for: news that landed while nobody was parked is not missed. */
  test('a change between two polls is answered at once rather than waited out', async () => {
    const news = new DesiredStateNews();
    news.served({ sessionToken: SESSION, generation: news.generation });
    news.changed();

    expect(await settled(news.awaited({ sessionToken: SESSION, signal: held() }))).toBe(true);
  });
});

describe('a host parked on a poll is woken by a change', () => {
  test('a change reaches the poll being held open', async () => {
    const news = new DesiredStateNews();
    news.served({ sessionToken: SESSION, generation: news.generation });
    const waiting = news.awaited({ sessionToken: SESSION, signal: held() });

    news.changed();

    expect(await settled(waiting)).toBe(true);
  });

  test('every host holding one is woken, not just the first', async () => {
    const news = new DesiredStateNews();
    for (const sessionToken of [SESSION, OTHER_SESSION]) {
      news.served({ sessionToken, generation: news.generation });
    }
    const both = [SESSION, OTHER_SESSION].map((sessionToken) =>
      news.awaited({ sessionToken, signal: held() }),
    );

    news.changed();

    expect(await Promise.all(both.map(settled))).toEqual([true, true]);
  });
});

describe('a hold that ends without news ends the wait', () => {
  test('an expired hold answers with the state the host already has', async () => {
    const news = new DesiredStateNews();
    news.served({ sessionToken: SESSION, generation: news.generation });
    const controller = new AbortController();
    const waiting = news.awaited({ sessionToken: SESSION, signal: controller.signal });

    controller.abort();

    expect(await settled(waiting)).toBe(true);
  });

  // What an agent that asked for no hold sends, and what one predating this gets by sending
  // nothing at all: the signal is already fired, so it is answered rather than parked.
  test('a hold already over is never parked on', async () => {
    const news = new DesiredStateNews();
    news.served({ sessionToken: SESSION, generation: news.generation });

    expect(
      await settled(news.awaited({ sessionToken: SESSION, signal: AbortSignal.abort() })),
    ).toBe(true);
  });
});

/**
 * The generation is taken before desired state is read and recorded after it is sent, so a change
 * landing during that read leaves the session owed another look. An extra round trip is the safe
 * end of that to be wrong at; the other end is a host never told about the change at all.
 */
describe('a change landing mid-read is not swallowed', () => {
  test('recording the generation the read began at leaves the session owed the newer one', async () => {
    const news = new DesiredStateNews();
    const generation = news.generation;
    news.changed();
    news.served({ sessionToken: SESSION, generation });

    expect(await settled(news.awaited({ sessionToken: SESSION, signal: held() }))).toBe(true);
  });
});
