import axios from 'axios';

/**
 * API client.
 * - Access token lives only in memory (never localStorage) to limit XSS blast radius.
 * - The refresh token is an httpOnly cookie scoped to /api; on a 401 we refresh once
 *   (single-flight, shared by concurrent requests) and replay the original request.
 */
const baseURL = import.meta.env.VITE_API_URL || '/api/v1';

export const api = axios.create({ baseURL, withCredentials: true, timeout: 20000 });

let accessToken = null;
let refreshPromise = null;
const listeners = new Set();

export const getAccessToken = () => accessToken;
export function setAccessToken(token) {
  accessToken = token || null;
}
/** Notified when the session can no longer be refreshed (forced logout). */
export function onSessionExpired(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${baseURL}/auth/refresh`, {}, { withCredentials: true, timeout: 15000 })
      .then((res) => {
        setAccessToken(res.data.data.accessToken);
        return res.data.data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

const NO_RETRY = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const code = error.response?.data?.error?.code;
    const retryable = ['TOKEN_EXPIRED', 'INVALID_TOKEN', 'TOKEN_REVOKED', 'UNAUTHORIZED'].includes(code);
    if (status === 401 && retryable && original && !original._retry && !NO_RETRY.some((p) => original.url?.includes(p))) {
      original._retry = true;
      try {
        await refreshSession();
        original.headers.Authorization = `Bearer ${accessToken}`;
        return api(original);
      } catch (refreshError) {
        setAccessToken(null);
        listeners.forEach((fn) => fn());
        return Promise.reject(normaliseError(refreshError));
      }
    }
    return Promise.reject(normaliseError(error));
  },
);

export class ApiRequestError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normaliseError(error) {
  if (error instanceof ApiRequestError) return error;
  const status = error.response?.status;
  const payload = error.response?.data?.error;
  let message = payload?.message;
  if (!message) {
    if (error.code === 'ECONNABORTED') message = 'The request timed out. Please try again.';
    else if (!error.response) message = 'Unable to reach Shelfify. Check your connection and try again.';
    else message = 'Something went wrong. Please try again.';
  }
  return new ApiRequestError(message, { status, code: payload?.code, details: payload?.details });
}

/** Unwraps `{ success, data, meta }` envelopes. */
export const unwrap = (res) => res.data.data;
export const unwrapPage = (res) => ({ items: res.data.data, meta: res.data.meta });
