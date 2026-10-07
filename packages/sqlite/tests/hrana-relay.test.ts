import { describe, expect, test } from 'bun:test';
import type { HranaPipelineReqBody, HranaPipelineRespBody } from '#hrana.ts';
import { HranaPipelineRelay } from '#hrana-relay.ts';
import { HranaStreams } from '#hrana-streams.ts';
import { openRecordingSession, RecordingHranaSession } from '#tests/support/session.ts';

const signal = new AbortController().signal;
const requests: HranaPipelineReqBody['requests'] = [{ type: 'close_sql', sql_id: 1 }];

function fixture() {
  const streams = new HranaStreams({ limit: undefined, idleTimeoutMs: undefined });
  const relay = new HranaPipelineRelay(streams);
  const session = new RecordingHranaSession();
  const open = openRecordingSession(session);
  return { streams, relay, session, open };
}

describe('Hrana pipeline relaying', () => {
  test('relays one complete pipeline while replacing private batons and suppressing guest URLs', async () => {
    const { streams, relay, session, open } = fixture();
    try {
      const first = await relay.handle({
        body: { requests },
        scope: 'owner/connection/deployment',
        open,
        signal,
      });
      expect(first.baton).not.toBe('private-guest-baton');
      expect(first.base_url).toBeNull();
      expect(session.pipelines[0]).toEqual({ baton: null, requests });
      const second = await relay.handle({
        body: { baton: first.baton, requests },
        scope: 'owner/connection/deployment',
        open,
        signal,
      });
      expect(second.baton).not.toBe(first.baton);
      expect(session.pipelines[1]).toEqual({ baton: 'private-guest-baton', requests });
      await expect(
        relay.handle({
          body: { baton: first.baton, requests },
          scope: 'owner/connection/deployment',
          open,
          signal,
        }),
      ).rejects.toThrow('expired');
      expect(session.pipelines).toHaveLength(2);
    } finally {
      await streams.closeAll();
    }
  });

  test('another scope cannot consume a public baton', async () => {
    const { streams, relay, session, open } = fixture();
    try {
      const first = await relay.handle({ body: { requests }, scope: 'first', open, signal });
      await expect(
        relay.handle({ body: { baton: first.baton, requests }, scope: 'second', open, signal }),
      ).rejects.toThrow('expired');
      await relay.handle({ body: { baton: first.baton, requests }, scope: 'first', open, signal });
      expect(session.pipelines).toHaveLength(2);
    } finally {
      await streams.closeAll();
    }
  });

  test('a closed guest pipeline releases the session without exposing a new baton', async () => {
    class ClosedSession extends RecordingHranaSession {
      override pipeline(_input: {
        body: HranaPipelineReqBody;
        signal: AbortSignal;
      }): Promise<HranaPipelineRespBody> {
        return Promise.resolve({
          baton: null,
          base_url: null,
          results: [{ type: 'ok', response: { type: 'close' } }],
        });
      }
    }
    const { streams, relay } = fixture();
    const session = new ClosedSession();
    const response = await relay.handle({
      body: { requests: [{ type: 'close' }] },
      scope: 'scope',
      open: openRecordingSession(session),
      signal,
    });
    expect(response.baton).toBeNull();
    expect(session.closed).toBe(true);
    await streams.closeAll();
  });

  test('a malformed response closes the session rather than returning partial results', async () => {
    class MissingResultsSession extends RecordingHranaSession {
      override pipeline(_input: {
        body: HranaPipelineReqBody;
        signal: AbortSignal;
      }): Promise<HranaPipelineRespBody> {
        return Promise.resolve({ baton: 'guest', base_url: null, results: [] });
      }
    }
    const { streams, relay } = fixture();
    const session = new MissingResultsSession();
    await expect(
      relay.handle({
        body: { requests },
        scope: 'scope',
        open: openRecordingSession(session),
        signal,
      }),
    ).rejects.toThrow('Invalid Hrana pipeline response');
    expect(session.closed).toBe(true);
    await streams.closeAll();
  });

  test('a mismatched response type closes the session', async () => {
    class MismatchedSession extends RecordingHranaSession {
      override pipeline(_input: {
        body: HranaPipelineReqBody;
        signal: AbortSignal;
      }): Promise<HranaPipelineRespBody> {
        return Promise.resolve({
          baton: 'guest',
          base_url: null,
          results: [{ type: 'ok', response: { type: 'sequence' } }],
        });
      }
    }
    const { streams, relay } = fixture();
    const session = new MismatchedSession();
    await expect(
      relay.handle({
        body: { requests },
        scope: 'scope',
        open: openRecordingSession(session),
        signal,
      }),
    ).rejects.toThrow('does not match');
    expect(session.closed).toBe(true);
    await streams.closeAll();
  });

  test('cancellation closes the stream and prevents reusing its private baton', async () => {
    const controller = new AbortController();
    class InterruptedSession extends RecordingHranaSession {
      override pipeline(_input: {
        body: HranaPipelineReqBody;
        signal: AbortSignal;
      }): Promise<HranaPipelineRespBody> {
        controller.abort(new Error('cancelled'));
        return Promise.reject(controller.signal.reason);
      }
    }
    const { streams, relay } = fixture();
    const session = new InterruptedSession();
    await expect(
      relay.handle({
        body: { requests },
        scope: 'scope',
        open: openRecordingSession(session),
        signal: controller.signal,
      }),
    ).rejects.toThrow('cancelled');
    expect(session.closed).toBe(true);
    await streams.closeAll();
  });
});
