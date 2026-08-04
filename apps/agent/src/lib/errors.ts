const MAX_MESSAGE_LENGTH = 512;

/** Tagged errors carry no `message`, so their fields are what describes them. */
export const describeError = (error: unknown): string =>
  error instanceof Error && error.message.length === 0
    ? `${error.name} ${JSON.stringify({ ...error })}`
    : String(error);

export const shortMessage = (error: unknown) => describeError(error).slice(0, MAX_MESSAGE_LENGTH);
