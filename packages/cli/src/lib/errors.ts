export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiError';
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
