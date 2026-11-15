/**
 * Strips keys that start with "$" or contain "." from user supplied objects to
 * prevent MongoDB operator injection (e.g. {"email": {"$gt": ""}}).
 * Works with Express 5 where req.query is an immutable getter.
 */
function clean(value, depth = 0) {
  if (depth > 10 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = clean(v, depth + 1);
  }
  return out;
}

export function sanitizeInput(req, _res, next) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) req.body = clean(req.body);
  if (req.params) req.params = clean(req.params);
  const q = req.query;
  if (q && typeof q === 'object') {
    Object.defineProperty(req, 'query', { value: clean(q), writable: true, configurable: true, enumerable: true });
  }
  next();
}
