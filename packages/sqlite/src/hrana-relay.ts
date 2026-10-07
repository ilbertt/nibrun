import type { HranaPipelineReqBody, HranaPipelineRespBody } from '#hrana.ts';
import { HranaError } from '#hrana-error.ts';
import type { HranaPipelineSessionContract } from '#hrana-session.ts';
import type { HranaStream, HranaStreams } from '#hrana-streams.ts';
import { parseHranaPipeline, parseHranaPipelineResponse } from '#hrana-validation.ts';

export class HranaPipelineRelay {
  readonly #streams: HranaStreams;
  readonly #guestBatons = new WeakMap<HranaStream, string>();

  constructor(streams: HranaStreams) {
    this.#streams = streams;
  }

  async handle({
    body,
    scope,
    open,
    signal,
  }: {
    body: unknown;
    scope: string;
    open: (input: { signal: AbortSignal }) => Promise<HranaPipelineSessionContract>;
    signal: AbortSignal;
  }): Promise<HranaPipelineRespBody> {
    const pipeline = parseHranaPipeline(body);
    const stream = await this.#streams.acquire({
      baton: pipeline.baton ?? null,
      scope,
      open,
      signal,
    });
    try {
      signal.throwIfAborted();
      const response = parseHranaPipelineResponse({
        body: await stream.session.pipeline({
          body: { ...pipeline, baton: this.#guestBatons.get(stream) ?? null },
          signal,
        }),
        requestCount: pipeline.requests.length,
      });
      assertResponseTypes({ response, requests: pipeline.requests });
      signal.throwIfAborted();
      if (stream.closed) {
        throw new HranaError({ message: 'Stream was invalidated', code: 'STREAM_EXPIRED' });
      }
      if (response.baton === null) {
        await this.#streams.close(stream);
      } else {
        this.#guestBatons.set(stream, response.baton);
      }
      return { results: response.results, baton: this.#streams.release(stream), base_url: null };
    } catch (error) {
      await this.#streams.close(stream).catch(function cleanupFailed() {});
      throw error;
    }
  }
}

function assertResponseTypes({
  response,
  requests,
}: {
  response: HranaPipelineRespBody;
  requests: HranaPipelineReqBody['requests'];
}): void {
  for (const [index, result] of response.results.entries()) {
    if (result.type === 'ok' && result.response.type !== requests[index]?.type) {
      throw new HranaError({
        message: 'Hrana response does not match its request',
        code: 'PROTO_ERROR',
      });
    }
  }
}
