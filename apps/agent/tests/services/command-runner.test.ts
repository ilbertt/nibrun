import { describe, expect, test } from 'bun:test';
import { Duration, Effect, Either, Layer } from 'effect';
import { CommandRunner, run } from '#services/command-runner.service.ts';
import { platform } from '#tests/support/run.ts';

const layer = Layer.provide(CommandRunner.Default, platform);

const TIMEOUT_MS = 200;
const TIMEOUT = Duration.millis(TIMEOUT_MS);
/**
 * How long the deaf process below stays alive. Long enough that waiting for it instead of
 * abandoning it is unmistakable in the elapsed time, short enough not to outlive the suite.
 */
const DEAF_LIFETIME_MS = 3000;
const ABANDONED_WITHIN_MS = 1500;

/**
 * A process that answers SIGTERM by carrying on, which is what a read of a wedged NBD device
 * amounts to: the kernel will not deliver the signal to a task sleeping uninterruptibly, so the
 * process outlives every attempt to kill it. This is the reproducible stand-in — no block device
 * required — for the thing that held an agent through its reconcile and its shutdown.
 */
const DEAF = [
  process.execPath,
  '-e',
  `process.on('SIGTERM', () => {}); setTimeout(() => {}, ${DEAF_LIFETIME_MS})`,
] as const;

function attempt<A, E>(effect: Effect.Effect<A, E, CommandRunner>) {
  return Effect.runPromise(Effect.provide(Effect.either(effect), layer));
}

describe('a timeout is worth what the caller can walk away from', () => {
  // The outage: closing the command's scope kills the process and then waits for it to exit, and
  // that wait is a finalizer, so it is uninterruptible. A timeout fired and then blocked on it,
  // which turned one unresponsive device into an agent that reconciled nothing, reported nothing
  // and could not be stopped.
  test('a process that ignores being killed does not hold the caller past the timeout', async () => {
    const startedAt = Date.now();

    const outcome = await attempt(run({ command: DEAF, timeout: TIMEOUT }));

    expect(Date.now() - startedAt).toBeLessThan(ABANDONED_WITHIN_MS);
    expect(Either.isLeft(outcome)).toBe(true);
  });

  test('what the caller gets back names the timeout rather than the process', async () => {
    const outcome = await attempt(run({ command: DEAF, timeout: TIMEOUT }));

    expect(Either.isLeft(outcome) && outcome.left._tag).toBe('CommandTimedOut');
  });
});

describe('what a command still does when it answers', () => {
  test('output and exit code come back', async () => {
    const outcome = await attempt(run({ command: ['echo', 'answered'] }));

    expect(outcome).toEqual(Either.right({ code: 0, stdout: 'answered\n', stderr: '' }));
  });

  test('stdin still reaches the process it was written for', async () => {
    const outcome = await attempt(run({ command: ['cat'], stdin: 'a ruleset' }));

    expect(Either.isRight(outcome) && outcome.right.stdout).toBe('a ruleset');
  });
});
