import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { useElapsed } from '#lib/hooks/use-elapsed.ts';

const A_MINUTE_MS = 60_000;
const TWO_MINUTES_MS = 120_000;
const TEN_SECONDS_MS = 10_000;

function Asked({ since }: { since: string }) {
  return <p>{useElapsed({ since, ms: A_MINUTE_MS }) ? 'offered' : 'not yet'}</p>;
}

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

// The first render decides what a page shows on arrival; the timer only carries it over the
// line later, and a static render has no timers to speak for.
describe('a moment counts as elapsed on the first render or not at all yet', () => {
  test('a domain asked for two minutes ago is offered the retry at once', () => {
    expect(renderToStaticMarkup(<Asked since={ago(TWO_MINUTES_MS)} />)).toContain('offered');
  });

  test('one asked for ten seconds ago is not, the edge still having its turn', () => {
    expect(renderToStaticMarkup(<Asked since={ago(TEN_SECONDS_MS)} />)).toContain('not yet');
  });
});
