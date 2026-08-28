import { AssertError } from '@repo/protocol';
import { type ErrorHandler, StatusMap } from 'elysia';
import { createLogger } from '#lib/logger.ts';
import { isMalformedIdentifier } from '#lib/pg-errors.ts';

const errorLogger = createLogger();

export class AppError extends Error {
  readonly statusCode: number;

  // biome-ignore lint/complexity/useMaxParams: extends native Error class
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad Request') {
    super(StatusMap['Bad Request'], message);
    this.name = 'BadRequestError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(StatusMap.Unauthorized, message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(StatusMap.Forbidden, message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not Found') {
    super(StatusMap['Not Found'], message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(StatusMap.Conflict, message);
    this.name = 'ConflictError';
  }
}

/** The api is already carrying as much of this kind of work as it will at once. */
export class TooManyRequestsError extends AppError {
  constructor(message = 'Too Many Requests') {
    super(StatusMap['Too Many Requests'], message);
    this.name = 'TooManyRequestsError';
  }
}

/** A host was asked something and said it could not answer it. */
export class BadGatewayError extends AppError {
  constructor(message = 'Bad Gateway') {
    super(StatusMap['Bad Gateway'], message);
    this.name = 'BadGatewayError';
  }
}

/** No host said anything at all before this end stopped waiting. */
export class GatewayTimeoutError extends AppError {
  constructor(message = 'Gateway Timeout') {
    super(StatusMap['Gateway Timeout'], message);
    this.name = 'GatewayTimeoutError';
  }
}

/**
 * Which field was refused and why, never what was in it. Elysia serialises the whole request body
 * into its message under `found`, and a request body now carries an app's environment — so
 * returning that message verbatim would answer a mistyped port with every secret that was sent
 * alongside it, in a response that crosses a proxy and lands in a browser's network log.
 *
 * Rebuilt from the parts worth keeping rather than filtered, so a field Elysia adds later is left
 * out until someone decides it is safe to include.
 */
function whatWasWrong(message: string): string {
  try {
    const { on, property, summary } = JSON.parse(message) as Record<string, unknown>;
    return JSON.stringify({ on, property, summary });
  } catch {
    return 'The request did not match what this endpoint accepts.';
  }
}

type ErrorHandlerOptions = Parameters<ErrorHandler>[0];
type ErrorHandlerResult = ReturnType<ErrorHandler>;

export function elysiaErrorHandler({
  error,
  code,
  status,
}: ErrorHandlerOptions): ErrorHandlerResult {
  if (error instanceof AppError) {
    if (error.statusCode >= StatusMap['Internal Server Error']) {
      errorLogger.error(code, error);
    }
    return status(error.statusCode, { error: error.message });
  }
  if (code === 'VALIDATION') {
    return status(StatusMap['Bad Request'], {
      error: 'Validation error',
      details: whatWasWrong(error.message),
    });
  }
  // A path segment is only a branded identifier once a handler has parsed it, so the schema that
  // rejects a malformed one throws here rather than at the edge, and would otherwise be a 500.
  // Named apart from Elysia's own so the two are told apart: this one failed past the edge.
  if (error instanceof AssertError) {
    return status(StatusMap['Bad Request'], {
      error: 'Protocol type validation error',
      details: error.message,
    });
  }
  if (code === 'NOT_FOUND') {
    return status(StatusMap['Not Found'], { error: 'Not Found' });
  }
  if (isMalformedIdentifier(error)) {
    return status(StatusMap['Bad Request'], { error: 'Malformed identifier' });
  }
  errorLogger.error(code, error);
  return status(StatusMap['Internal Server Error'], { error: 'Internal server error' });
}
