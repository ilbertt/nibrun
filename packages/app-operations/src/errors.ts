export class InvalidPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPathError';
  }
}

export class InvalidEnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEnvironmentError';
  }
}

export class InvalidIdleTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidIdleTimeoutError';
  }
}
