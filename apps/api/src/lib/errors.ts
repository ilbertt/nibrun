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
    return status(StatusMap['Bad Request'], { error: 'Validation error', details: error.message });
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
