import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}
export const badRequest = (m: string, code = 'BAD_REQUEST') => new HttpError(400, code, m);
export const unauthorized = (m = 'Please sign in to continue.', code = 'UNAUTHENTICATED') => new HttpError(401, code, m);
export const forbidden = (m = 'You do not have permission to do that.', code = 'FORBIDDEN') => new HttpError(403, code, m);
export const notFound = (m = 'Not found.') => new HttpError(404, 'NOT_FOUND', m);
export const conflict = (m: string, code = 'CONFLICT') => new HttpError(409, code, m);
export const tooMany = (m: string, code = 'RATE_LIMITED') => new HttpError(429, code, m);

export const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue?.path?.length ? `${issue.path.join('.')}: ` : '';
    throw new HttpError(400, 'VALIDATION_ERROR', `${where}${issue?.message ?? 'Invalid request.'}`, {
      fields: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return r.data;
}

export function errorHandler(logger: Pick<Console, 'error'> = console) {
  return (err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, message: err.message, ...(err.extra ?? {}) });
    }
    if (err instanceof ZodError) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: err.issues[0]?.message ?? 'Invalid request.' });
    }
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'FILE_TOO_LARGE', message: 'The file exceeds the maximum allowed size.' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'BAD_JSON', message: 'Request body is not valid JSON.' });
    }
    logger.error('[unhandled]', err?.stack || err);
    return res.status(500).json({ error: 'INTERNAL', message: 'Something went wrong on our side. Please try again.' });
  };
}
