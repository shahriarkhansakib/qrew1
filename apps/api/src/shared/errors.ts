export interface ErrorDetail {
  readonly field?: string;
  readonly message: string;
  readonly code?: string;
}

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: readonly ErrorDetail[];
  public readonly exposeMessage: boolean;

  constructor(params: {
    code: string;
    message: string;
    statusCode: number;
    details?: readonly ErrorDetail[];
    exposeMessage?: boolean;
    cause?: unknown;
  }) {
    super(params.message, params.cause ? { cause: params.cause } : undefined);
    this.name = this.constructor.name;
    this.code = params.code;
    this.statusCode = params.statusCode;
    this.details = params.details;
    this.exposeMessage = params.exposeMessage ?? params.statusCode < 500;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BadRequestError extends AppError {
  constructor(code: string, message: string, details?: readonly ErrorDetail[]) {
    super({ code, message, statusCode: 400, details, exposeMessage: true });
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed', details?: readonly ErrorDetail[]) {
    super({ code: 'VALIDATION_ERROR', message, statusCode: 422, details, exposeMessage: true });
  }
}

export class UnauthorizedError extends AppError {
  constructor(code = 'UNAUTHORIZED', message = 'Authentication is required') {
    super({ code, message, statusCode: 401, exposeMessage: true });
  }
}

export class ForbiddenError extends AppError {
  constructor(code = 'FORBIDDEN', message = 'You do not have permission to perform this action') {
    super({ code, message, statusCode: 403, exposeMessage: true });
  }
}

export class NotFoundError extends AppError {
  constructor(code = 'NOT_FOUND', message = 'Requested resource was not found') {
    super({ code, message, statusCode: 404, exposeMessage: true });
  }
}

export class ConflictError extends AppError {
  constructor(code = 'CONFLICT', message = 'Resource conflict') {
    super({ code, message, statusCode: 409, exposeMessage: true });
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super({ code: 'RATE_LIMITED', message, statusCode: 429, exposeMessage: true });
  }
}

export class InternalServerError extends AppError {
  constructor(message = 'An internal error occurred', cause?: unknown) {
    super({
      code: 'INTERNAL_ERROR',
      message,
      statusCode: 500,
      exposeMessage: false,
      cause,
    });
  }
}
