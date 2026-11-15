export class ApiError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message Human readable message (safe to show to clients)
   * @param {object} [options]
   * @param {string} [options.code] Stable machine readable code
   * @param {unknown} [options.details] Extra validation details
   */
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code || ApiError.defaultCode(status);
    this.details = details;
    this.expose = true;
  }

  static defaultCode(status) {
    return (
      {
        400: 'BAD_REQUEST',
        401: 'UNAUTHORIZED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        422: 'UNPROCESSABLE',
        429: 'RATE_LIMITED',
        503: 'SERVICE_UNAVAILABLE',
      }[status] || 'INTERNAL_ERROR'
    );
  }

  static badRequest(msg, opts) {
    return new ApiError(400, msg, opts);
  }
  static unauthorized(msg = 'Authentication required', opts) {
    return new ApiError(401, msg, opts);
  }
  static forbidden(msg = 'You do not have permission to perform this action', opts) {
    return new ApiError(403, msg, opts);
  }
  static notFound(msg = 'Resource not found', opts) {
    return new ApiError(404, msg, opts);
  }
  static conflict(msg, opts) {
    return new ApiError(409, msg, opts);
  }
  static unavailable(msg, opts) {
    return new ApiError(503, msg, opts);
  }
}
