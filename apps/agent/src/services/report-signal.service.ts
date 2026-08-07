import { Effect, Queue } from 'effect';

const ONE_PENDING = 1;

/**
 * Says a report is worth sending before the interval is up.
 *
 * The report is the only channel carrying an instance's state to the control plane, and it is
 * what turns a deployment `active` — so on the interval alone every deploy pays for a tenant
 * that answered just after the last one went out. Sliding and one deep, because what a raise
 * says is "something moved", and two of them say nothing more than one.
 */
export class ReportSignal extends Effect.Service<ReportSignal>()('ReportSignal', {
  accessors: true,
  effect: Effect.gen(function* () {
    const news = yield* Queue.sliding<void>(ONE_PENDING);
    return {
      raise: Effect.asVoid(Queue.offer(news, undefined)),
      awaited: Queue.take(news),
    };
  }),
}) {}
