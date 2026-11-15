import { ApiError } from '../lib/ApiError.js';

/**
 * Validates and coerces request input with zod.
 * Parsed values are exposed on `req.valid.{body,query,params}`
 * (Express 5 exposes `req.query` as a read-only getter).
 */
export const validate =
  ({ body, query, params } = {}) =>
  (req, _res, next) => {
    req.valid = req.valid || {};
    const parts = { body, query, params };
    for (const [key, schema] of Object.entries(parts)) {
      if (!schema) continue;
      const result = schema.safeParse(req[key] ?? {});
      if (!result.success) {
        const details = result.error.issues.map((i) => ({ field: i.path.join('.') || key, message: i.message }));
        return next(new ApiError(422, details[0]?.message || 'Invalid input', { code: 'VALIDATION_ERROR', details }));
      }
      req.valid[key] = result.data;
      if (key === 'body') req.body = result.data;
    }
    next();
  };
