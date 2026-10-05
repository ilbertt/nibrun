import { type HranaPipelineReqBody, HranaPipelineReqBodySchema, Value } from '@repo/protocol';
import { HranaError } from '#lib/hrana/errors.ts';

const MAX_STRUCTURE_DEPTH = 32;
const MAX_STRUCTURE_NODES = 16_384;

export function parseHranaPipeline(body: unknown): HranaPipelineReqBody {
  validateStructure(body);
  if (!Value.Check(HranaPipelineReqBodySchema, body)) {
    throw new HranaError({ message: 'Invalid Hrana pipeline', code: 'PROTO_ERROR' });
  }
  return body;
}

function validateStructure(body: unknown): void {
  const pending = [{ value: body, depth: 0 }];
  let nodes = 0;
  while (pending.length > 0) {
    const item = pending.pop()!;
    nodes += 1;
    if (nodes > MAX_STRUCTURE_NODES || item.depth > MAX_STRUCTURE_DEPTH) {
      throw new HranaError({ message: 'Hrana request is too complex', code: 'PROTO_ERROR' });
    }
    if (item.value !== null && typeof item.value === 'object') {
      for (const value of Object.values(item.value)) {
        pending.push({ value, depth: item.depth + 1 });
      }
    }
  }
}
