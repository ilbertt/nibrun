import { ApiRefusal } from '@repo/api-client/unwrap';
import { type AppQuotaRefusal, AppQuotaRefusalSchema, Value } from '@repo/protocol';

/**
 * The refusal a failed deploy was, when it was the account's limit rather than anything about the
 * binary — the one failure whose way out is asking somebody, so a caller may want to show more
 * than the sentence. `undefined` for every other failure, which the sentence already covers.
 */
export function appQuotaRefusal(failure: unknown): AppQuotaRefusal | undefined {
  return failure instanceof ApiRefusal && Value.Check(AppQuotaRefusalSchema, failure.body)
    ? failure.body
    : undefined;
}
