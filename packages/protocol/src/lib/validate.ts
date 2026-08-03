import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const MAX_REPORTED_ISSUES = 10;

export type ProtocolIssue = {
  path: string;
  message: string;
};

/**
 * Thrown when a message does not match the schema the other side is expected to send.
 *
 * The agent and the control plane are deployed by different pipelines, so they are out of
 * sync during every rollout. That is the normal state, not an edge case, and this error is
 * what turns it into a rejected message rather than silently misinterpreted state.
 */
export class ProtocolValidationError extends Error {
  readonly issues: ProtocolIssue[];

  constructor({ issues }: { issues: ProtocolIssue[] }) {
    super(`Message does not match the protocol: ${issues.map(describe).join('; ')}`);
    this.name = 'ProtocolValidationError';
    this.issues = issues;
  }
}

const describe = (issue: ProtocolIssue) => `${issue.path || '/'} ${issue.message}`;

export function isValidMessage({ schema, value }: { schema: TSchema; value: unknown }): boolean {
  return Value.Check(schema, value);
}

/**
 * Validates a decoded JSON message against `schema` and returns it typed.
 *
 * Unknown properties are deliberately tolerated: during a rollout the newer side sends fields
 * the older side has never heard of, and rejecting those would make every deploy an outage.
 * Missing and mistyped fields — the failures that actually corrupt state — still throw.
 */
export function parseMessage<Schema extends TSchema>({
  schema,
  value,
}: {
  schema: Schema;
  value: unknown;
}): Static<Schema> {
  if (Value.Check(schema, value)) {
    return value as Static<Schema>;
  }
  throw new ProtocolValidationError({ issues: collectIssues({ schema, value }) });
}

// Value.Errors carries the offending value on every entry. Tenant environment variables are
// among the things validated here, so the value is dropped rather than travelling into an
// exception message that something will eventually log.
function collectIssues({ schema, value }: { schema: TSchema; value: unknown }): ProtocolIssue[] {
  const issues: ProtocolIssue[] = [];
  for (const error of Value.Errors(schema, value)) {
    if (issues.length >= MAX_REPORTED_ISSUES) {
      break;
    }
    issues.push({ path: error.path, message: error.message });
  }
  return issues;
}
