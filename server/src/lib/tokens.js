import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { randomToken, sha256 } from './utils.js';
import { ApiError } from './ApiError.js';

export const REFRESH_COOKIE = 'sf_rt';
const ISSUER = 'shelfify-api';
const AUDIENCE = 'shelfify-web';

export function signAccessToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role, tv: user.tokenVersion ?? 0 }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
}

/**
 * Refresh tokens are opaque random strings. Only their SHA-256 hash is stored,
 * they rotate on every use and belong to a "family" so that re-use of a rotated
 * token (a strong theft signal) revokes the whole family.
 */
export async function issueRefreshToken(user, { family, userAgent, ip } = {}) {
  const token = randomToken(48);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await RefreshToken.create({
    user: user._id,
    tokenHash: sha256(token),
    family: family || randomToken(16),
    expiresAt,
    userAgent: userAgent?.slice(0, 256),
    ip,
  });
  return { token, expiresAt };
}

export async function rotateRefreshToken(rawToken, meta) {
  if (!rawToken) throw ApiError.unauthorized('Session expired', { code: 'NO_REFRESH_TOKEN' });
  const tokenHash = sha256(rawToken);

  // Atomically mark as used so concurrent refreshes cannot both succeed.
  const existing = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: false },
  );

  if (!existing) {
    const reused = await RefreshToken.findOne({ tokenHash });
    if (reused) {
      await RefreshToken.updateMany({ family: reused.family, revokedAt: null }, { $set: { revokedAt: new Date() } });
    }
    throw ApiError.unauthorized('Session expired', { code: 'INVALID_REFRESH_TOKEN' });
  }
  if (existing.expiresAt < new Date()) {
    throw ApiError.unauthorized('Session expired', { code: 'REFRESH_TOKEN_EXPIRED' });
  }
  return { userId: existing.user, family: existing.family, meta };
}

export async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  await RefreshToken.updateOne({ tokenHash: sha256(rawToken), revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function revokeAllForUser(userId) {
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export function refreshCookieOptions(expires) {
  return {
    httpOnly: true,
    secure: env.isProd || env.COOKIE_SAMESITE === 'none',
    // Frontend calls the API through a same-origin rewrite in production, so Lax is sufficient
    // and protects the refresh endpoint against CSRF from third-party sites.
    sameSite: env.COOKIE_SAMESITE,
    path: '/api',
    ...(expires ? { expires } : {}),
  };
}
