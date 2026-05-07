// backend/src/validate.ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodTypeAny } from 'zod';

type Source = 'body' | 'query' | 'params';

/**
 * Returns an Express middleware that parses req[source] with the given zod schema
 * and replaces the raw value with the parsed result. Throws ZodError on failure,
 * caught by errorHandler.
 */
export function validate<T extends ZodTypeAny>(schema: T, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const parsed = (schema as ZodSchema).parse((req as any)[source]);
    (req as any)[source] = parsed;
    next();
  };
}
