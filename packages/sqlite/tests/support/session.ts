import type { HranaPipelineReqBody, HranaPipelineRespBody } from '#hrana.ts';
import { HranaPipelineSessionContract } from '#hrana-session.ts';

export class RecordingHranaSession extends HranaPipelineSessionContract {
  readonly pipelines: HranaPipelineReqBody[] = [];
  closed = false;

  override pipeline({
    body,
  }: {
    body: HranaPipelineReqBody;
    signal: AbortSignal;
  }): Promise<HranaPipelineRespBody> {
    this.pipelines.push(body);
    return Promise.resolve({
      baton: 'private-guest-baton',
      base_url: 'http://guest.internal/',
      results: body.requests.map(function response(request) {
        if (request.type !== 'close_sql') {
          throw new Error('Unexpected request in session fixture');
        }
        return { type: 'ok' as const, response: { type: request.type } };
      }),
    });
  }

  override close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

export function openRecordingSession(session: RecordingHranaSession) {
  return function open(_input: { signal: AbortSignal }) {
    return Promise.resolve(session);
  };
}
