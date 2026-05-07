// backend/src/errors.ts
import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger';

/**
 * Application error: a controlled, expected error whose `message` is safe to send
 * to the client. Anything else is treated as an unexpected internal error and the
 * message is replaced with a generic one.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly publicDetail?: Record<string, unknown>;

  constructor(
    code: string,
    statusCode = 400,
    message?: string,
    publicDetail?: Record<string, unknown>
  ) {
    super(message || code);
    this.code = code;
    this.statusCode = statusCode;
    this.publicDetail = publicDetail;
  }
}

/**
 * Wraps an async route so thrown errors flow into errorHandler instead of dying.
 * Express 4 doesn't natively await Promise routes.
 */
export function asyncHandler<T extends (...args: any[]) => any>(fn: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Final error middleware. Logs the full error server-side; returns a sanitized
 * response with a request ID so support can correlate.
 */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const reqId = (req as any).id;

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'validation_error',
      requestId: reqId,
      issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
    });
    return;
  }

  if (err instanceof AppError) {
    logger.warn({ err, reqId, code: err.code }, 'AppError');
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
      requestId: reqId,
      ...(err.publicDetail || {}),
    });
    return;
  }

  // Unknown / unexpected error: do NOT leak the message to the client.
  logger.error({ err, reqId }, 'unhandled_error');
  res.status(500).json({
    error: 'internal_error',
    requestId: reqId,
  });
}

/** 404 fallback. Mounted after all routes. */
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: 'not_found', requestId: (req as any).id });
}
