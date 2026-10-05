import type {
  HranaBatch,
  HranaBatchResult,
  HranaBatchCond as HranaCondition,
  HranaStmtResult,
} from '@repo/protocol';
import { HranaError, hranaError } from '#lib/hrana/errors.ts';
import type { SqliteExecutorContract } from '#lib/hrana/executor.ts';
import { hranaStatement } from '#lib/hrana/sql.ts';

export async function executeHranaBatch({
  batch,
  executor,
  storedSql,
  signal,
}: {
  batch: HranaBatch;
  executor: SqliteExecutorContract;
  storedSql: ReadonlyMap<number, string>;
  signal: AbortSignal;
}): Promise<HranaBatchResult> {
  const result: HranaBatchResult = { step_results: [], step_errors: [] };
  for (const step of batch.steps) {
    let value: HranaStmtResult | null = null;
    let error: HranaBatchResult['step_errors'][number] = null;
    try {
      signal.throwIfAborted();
      if (step.condition == null || evaluateCondition({ condition: step.condition, result })) {
        value = await executor.execute({
          statement: hranaStatement({ statement: step.stmt, storedSql }),
          signal,
        });
      }
    } catch (caught) {
      signal.throwIfAborted();
      error = hranaError(caught);
    }
    result.step_results.push(value);
    result.step_errors.push(error);
  }
  return result;
}

function evaluateCondition({
  condition,
  result,
}: {
  condition: HranaCondition;
  result: HranaBatchResult;
}): boolean {
  switch (condition.type) {
    case 'ok':
    case 'error':
      if (condition.step >= result.step_results.length) {
        throw new HranaError({
          message: 'Batch conditions may only reference earlier steps',
          code: 'PROTO_ERROR',
        });
      }
      return condition.type === 'ok'
        ? result.step_results[condition.step] !== null
        : result.step_errors[condition.step] !== null;
    case 'not':
      return !evaluateCondition({ condition: condition.cond, result });
    case 'and':
      return condition.conds.every(function matches(cond) {
        return evaluateCondition({ condition: cond, result });
      });
    case 'or':
      return condition.conds.some(function matches(cond) {
        return evaluateCondition({ condition: cond, result });
      });
  }
}
