import mongoose from 'mongoose';
import { ApiError } from '../lib/ApiError.js';
import { env } from '../config/env.js';

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} not found`, { code: 'ROUTE_NOT_FOUND' }));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let error = err;

  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    error = new ApiError(422, details[0]?.message || 'Validation failed', { code: 'VALIDATION_ERROR', details });
  } else if (err instanceof mongoose.Error.CastError) {
    error = ApiError.badRequest(`Invalid ${err.path}`, { code: 'INVALID_ID' });
  } else if (err?.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    error = ApiError.conflict(`A record with this ${field} already exists`, { code: 'DUPLICATE' });
  } else if (err?.type === 'entity.parse.failed') {
    error = ApiError.badRequest('Malformed JSON body', { code: 'INVALID_JSON' });
  } else if (err?.type === 'entity.too.large') {
    error = new ApiError(413, 'Request body too large', { code: 'PAYLOAD_TOO_LARGE' });
  } else if (!(err instanceof ApiError)) {
    error = new ApiError(500, 'Something went wrong on our side', { code: 'INTERNAL_ERROR' });
    error.cause = err;
  }

  const status = error.status || 500;
  const log = req.log || console;
  if (status >= 500) log.error({ err: error.cause || err }, 'unhandled error');
  else log.debug?.({ code: error.code, status }, error.message);

  res.status(status).json({
    success: false,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      ...(!env.isProd && status >= 500 && error.cause ? { debug: String(error.cause?.message || error.cause) } : {}),
    },
    requestId: req.id,
  });
}
