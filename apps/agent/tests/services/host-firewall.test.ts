import { describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import type { CommandRequest } from '#lib/exec.ts';
import type { FirewallState } from '#lib/network/firewall.ts';
import { HostFirewall } from '#services/host-firewall.service.ts';
import { recordingCommands, succeeding } from '#tests/support/commands.ts';

const METAINFO =
  '{"metainfo": {"version": "1.0.4", "release_name": "Lester Gooch #3", "json_schema_version": 1}}';

const holding = (handle: number) =>
  `{"nftables": [${METAINFO}, {"table": {"family": "ip", "name": "nibrun", "handle": ${handle}}}, {"table": {"family": "ip6", "name": "nibrun", "handle": ${handle + 1}}}]}`;

/** A host after `nft flush ruleset`: the command succeeds and names no table of ours. */
const FLUSHED = `{"nftables": [${METAINFO}]}`;

const LISTING_FAILED = 1;

/** What AL2023 answered after a first write, and after the pair had been rebuilt under the agent. */
const WRITTEN_HANDLE = 2;
const REBUILT_HANDLE = 8;

const state = (overrides: Partial<FirewallState> = {}): FirewallState => ({
  instances: [],
  controlPlaneCidrsV4: [],
  controlPlaneCidrsV6: [],
  ...overrides,
});

const isListing = ({ command }: CommandRequest) => command.includes('list');

/** What each call did, in order, which is what says whether the kernel was consulted before a skip. */
const stepsOf = (commands: readonly CommandRequest[]) =>
  commands.map((request) => (isListing(request) ? 'list' : 'write'));

/**
 * Each `nft -j list tables` takes the next answer and the last one stands for every call after,
 * so a script says what the kernel does between two applies and nothing about how often it is
 * asked. `undefined` is a listing that could not be run at all.
 */
function host(answers: readonly (string | undefined)[]) {
  let index = 0;
  const recorder = recordingCommands((request) => {
    if (!isListing(request)) {
      return succeeding();
    }
    const answer = answers[Math.min(index, answers.length - 1)];
    index += 1;
    return answer === undefined
      ? succeeding({ code: LISTING_FAILED, stderr: 'nft: unknown option' })
      : succeeding({ stdout: answer });
  });
  // Merged rather than only provided: `apply` reaches for the runner when it is called, not when
  // the service is built, so the caller needs it in context too.
  return { recorder, layer: HostFirewall.Default.pipe(Layer.provideMerge(recorder.layer)) };
}

function applying({
  answers,
  states,
}: {
  answers: readonly (string | undefined)[];
  states: readonly FirewallState[];
}) {
  const { recorder, layer } = host(answers);
  return Effect.runPromise(
    Effect.gen(function* () {
      const firewall = yield* HostFirewall;
      for (const each of states) {
        yield* firewall.apply(each);
      }
      return stepsOf(recorder.commands);
    }).pipe(Effect.provide(layer)),
  );
}

describe('an unchanged ruleset is written again only when the kernel stopped holding it', () => {
  test('a host still holding what was written is left alone', async () => {
    const steps = await applying({
      answers: [holding(WRITTEN_HANDLE)],
      states: [state(), state()],
    });
    expect(steps).toEqual(['write', 'list', 'list']);
  });

  test('a ruleset flushed out of band is written again', async () => {
    const steps = await applying({
      answers: [holding(WRITTEN_HANDLE), FLUSHED],
      states: [state(), state()],
    });
    expect(steps).toEqual(['write', 'list', 'list', 'write', 'list']);
  });

  test('tables something else rebuilt are written again, though the text has not changed', async () => {
    const steps = await applying({
      answers: [holding(WRITTEN_HANDLE), holding(REBUILT_HANDLE)],
      states: [state(), state()],
    });
    expect(steps).toEqual(['write', 'list', 'list', 'write', 'list']);
  });

  test('a listing that could not be run leaves nothing to skip on', async () => {
    const steps = await applying({
      answers: [undefined],
      states: [state(), state()],
    });
    expect(steps).toEqual(['write', 'list', 'write', 'list']);
  });

  test('a changed ruleset is written without asking the kernel anything first', async () => {
    const steps = await applying({
      answers: [holding(WRITTEN_HANDLE)],
      states: [state(), state({ controlPlaneCidrsV4: ['10.43.0.0/16'] })],
    });
    expect(steps).toEqual(['write', 'list', 'write', 'list']);
  });
});
