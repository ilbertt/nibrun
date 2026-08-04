const MAX_MESSAGE_LENGTH = 512;

/**
 * Every failure this agent raises is a `Data.TaggedError` that renders itself, so describing one
 * is reading its message rather than serialising its fields — which is what kept a credential one
 * careless field away from a log line.
 */
export function describe(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message.length > 0 ? cause.message : cause.name;
  }
  return String(cause);
}

/** The `message` a report carries to the control plane, and from there to an operator. */
export function reportedMessage(error: unknown): string {
  return describe(error).slice(0, MAX_MESSAGE_LENGTH);
}
