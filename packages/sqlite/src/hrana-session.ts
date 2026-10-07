import type { HranaPipelineReqBody, HranaPipelineRespBody } from '#hrana.ts';

export abstract class HranaPipelineSessionContract {
  abstract pipeline(input: {
    body: HranaPipelineReqBody;
    signal: AbortSignal;
  }): Promise<HranaPipelineRespBody>;
  abstract close(): Promise<void>;
}
