import { Effect, Queue } from 'effect';

const ONE_PENDING = 1;

/**
 * Says the host's own picture of what is running has moved, before the tick is up.
 *
 * The status loop chooses how long to sleep from the state as it stood when it last refreshed, so
 * a microVM that comes up mid-sleep waits out a second measured for a host where nothing was
 * happening. That second is the whole of it: until the loop refreshes, the record still says the
 * app is coming up, the forward rule is rendered from records that are running, and every request
 * arriving meanwhile is answered by the activator rather than by the guest it is already for.
 *
 * Sliding and one deep, for the reason `ReportSignal` is: a raise says "something moved", and two
 * of them say nothing more than one.
 */
export class RefreshSignal extends Effect.Service<RefreshSignal>()('RefreshSignal', {
  accessors: true,
  effect: Effect.gen(function* () {
    const news = yield* Queue.sliding<void>(ONE_PENDING);
    return {
      raise: Effect.asVoid(Queue.offer(news, undefined)),
      awaited: Queue.take(news),
    };
  }),
}) {}
