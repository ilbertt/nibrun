/** Something wrong with what was typed, decided here rather than by sending it and being told. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

// Raised when someone walks away from a prompt. Reported by exit code alone: clack has already
// written the goodbye by the time this is thrown, and a second line would only repeat it.
export class CancelledError extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'CancelledError';
  }
}
