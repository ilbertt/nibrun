import { describe, expect, test } from 'bun:test';
import { parseHranaPipeline, parseHranaPipelineResponse } from '#hrana-validation.ts';
import { SQLITE_MAX_REQUEST_BYTES } from '#limits.ts';

describe('Hrana pipeline validation', () => {
  test('accepts typed arguments and ignores future protocol fields', () => {
    const body: unknown = {
      baton: null,
      requests: [
        {
          type: 'execute',
          stmt: { sql: 'SELECT ?', args: [{ type: 'integer', value: '9223372036854775807' }] },
        },
      ],
      future: true,
    };
    expect(JSON.stringify(parseHranaPipeline(body))).toBe(JSON.stringify(body));
  });

  test('rejects unknown request types and malformed values', () => {
    expect(() => {
      parseHranaPipeline({ baton: null, requests: [{ type: 'unknown' }] });
    }).toThrow('Invalid Hrana pipeline');
    expect(() => {
      parseHranaPipeline({
        baton: null,
        requests: [
          { type: 'execute', stmt: { sql: 'SELECT ?', args: [{ type: 'integer', value: '1.5' }] } },
        ],
      });
    }).toThrow('Invalid Hrana pipeline');
  });

  test('bounds request count and recursive conditions before schema validation', () => {
    const TOO_MANY_REQUESTS = 65;
    expect(() => {
      parseHranaPipeline({
        baton: null,
        requests: Array.from({ length: TOO_MANY_REQUESTS }, () => ({ type: 'close' })),
      });
    }).toThrow('Invalid Hrana pipeline');
    const DEEP_CONDITION_COUNT = 40;
    let condition: unknown = { type: 'ok', step: 0 };
    for (let index = 0; index < DEEP_CONDITION_COUNT; index += 1) {
      condition = { type: 'not', cond: condition };
    }
    expect(() => {
      parseHranaPipeline({
        baton: null,
        requests: [{ type: 'batch', batch: { steps: [{ condition, stmt: { sql: 'SELECT 1' } }] } }],
      });
    }).toThrow('too complex');
  });
});

test('response nesting is bounded before recursive schema validation', () => {
  const TOO_DEEP = 40;
  let nested: unknown = {};
  for (let depth = 0; depth < TOO_DEEP; depth += 1) {
    nested = { nested };
  }
  expect(() => {
    parseHranaPipelineResponse({
      body: { baton: null, base_url: null, results: [], nested },
      requestCount: 0,
    });
  }).toThrow('too complex');
});

test('whole-pipeline limits bound ignored extension fields as well as SQL values', () => {
  const extra = 'x'.repeat(SQLITE_MAX_REQUEST_BYTES);
  expect(() => {
    parseHranaPipeline({ requests: [], extra });
  }).toThrow('byte limit');
  expect(() => {
    parseHranaPipelineResponse({
      body: { baton: null, base_url: null, results: [], extra },
      requestCount: 0,
    });
  }).toThrow('byte limit');
});
