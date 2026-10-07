import { Value } from '@sinclair/typebox/value';
import {
  type HranaPipelineReqBody,
  HranaPipelineReqBodySchema,
  type HranaPipelineRespBody,
  HranaPipelineRespBodySchema,
} from '#hrana.ts';
import { HranaError } from '#hrana-error.ts';
import { SQLITE_MAX_REQUEST_BYTES, SQLITE_MAX_RESPONSE_BYTES } from '#limits.ts';

const MAX_STRUCTURE_DEPTH = 32;
const MAX_STRUCTURE_NODES = 16_384;
const MAX_RESPONSE_STRUCTURE_NODES = 1_048_576;

export function parseHranaPipeline(body: unknown): HranaPipelineReqBody {
  validateStructure({ body, maxNodes: MAX_STRUCTURE_NODES });
  if (!Value.Check(HranaPipelineReqBodySchema, body)) {
    throw new HranaError({ message: 'Invalid Hrana pipeline', code: 'PROTO_ERROR' });
  }
  assertByteLimit({ body, limit: SQLITE_MAX_REQUEST_BYTES });
  return body;
}

function validateStructure({ body, maxNodes }: { body: unknown; maxNodes: number }): void {
  const pending = [{ value: body, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const item = pending.pop()!;
    nodes += 1;
    if (nodes > maxNodes || item.depth > MAX_STRUCTURE_DEPTH) {
      throw new HranaError({ message: 'Hrana pipeline is too complex', code: 'PROTO_ERROR' });
    }
    if (item.value !== null && typeof item.value === 'object') {
      for (const value of Object.values(item.value)) {
        if (pending.length + nodes >= maxNodes) {
          throw new HranaError({ message: 'Hrana pipeline is too complex', code: 'PROTO_ERROR' });
        }
        pending.push({ value, depth: item.depth + 1 });
      }
    }
  }
}

export function parseHranaPipelineResponse({
  body,
  requestCount,
}: {
  body: unknown;
  requestCount: number;
}): HranaPipelineRespBody {
  validateStructure({ body, maxNodes: MAX_RESPONSE_STRUCTURE_NODES });
  if (!Value.Check(HranaPipelineRespBodySchema, body) || body.results.length !== requestCount) {
    throw new HranaError({ message: 'Invalid Hrana pipeline response', code: 'PROTO_ERROR' });
  }
  assertByteLimit({ body, limit: SQLITE_MAX_RESPONSE_BYTES });
  return body;
}

function assertByteLimit({ body, limit }: { body: unknown; limit: number }): void {
  if (Buffer.byteLength(JSON.stringify(body)) > limit) {
    throw new HranaError({
      message: 'Hrana pipeline exceeds the byte limit',
      code: 'RESULT_TOO_LARGE',
    });
  }
}
