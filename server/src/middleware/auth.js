import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { ApiError } from '../lib/ApiError.js';

function extractToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

async function resolveUser(token) {
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Access token expired', { code: 'TOKEN_EXPIRED' });
    }
    throw ApiError.unauthorized('Invalid access token', { code: 'INVALID_TOKEN' });
  }

  const user = await User.findById(payload.sub).select('name email role isBlocked tokenVersion').lean();
  if (!user) throw ApiError.unauthorized('Account no longer exists', { code: 'INVALID_TOKEN' });
  if (user.isBlocked) throw ApiError.forbidden('This account has been suspended', { code: 'ACCOUNT_BLOCKED' });
  if ((user.tokenVersion ?? 0) !== (payload.tv ?? 0)) {
    throw ApiError.unauthorized('Session revoked, please sign in again', { code: 'TOKEN_REVOKED' });
  }
  return { id: String(user._id), _id: user._id, name: user.name, email: user.email, role: user.role };
}

export async function authenticate(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next(ApiError.unauthorized());
  req.user = await resolveUser(token);
  next();
}

/** Attaches req.user when a valid token is present, but never rejects. */
export async function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      req.user = await resolveUser(token);
    } catch {
      req.user = undefined;
    }
  }
  next();
}

export const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    next();
  };
