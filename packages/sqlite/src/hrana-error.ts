export class HranaError extends Error {
  readonly code: string;

  constructor({ message, code }: { message: string; code: string }) {
    super(message);
    this.name = 'HranaError';
    this.code = code;
  }
}
