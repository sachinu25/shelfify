import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { FAMILY_KILL_REASONS, RefreshToken } from '../models/RefreshToken.js';
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

const MAX_GRACE_USES = 3;

/**
 * Ends a session family. `markTokenId` is always stamped with the reason too, so the
 * family is recorded as terminated even when every token in it was already rotated.
 */
async function killFamily(family, reason, markTokenId) {
  const now = new Date();
  await RefreshToken.updateMany({ family, revokedAt: null }, { $set: { revokedAt: now, revokedReason: reason } });
  // Never overwrite an earlier terminal reason (e.g. replaying a logged-out cookie must not
  // turn "logout" into "reuse"): only a merely rotated token gets stamped. Any terminal
  // reason already marks the family as ended, so reuse detection is unaffected.
  if (markTokenId) {
    await RefreshToken.updateOne({ _id: markTokenId, revokedReason: { $nin: FAMILY_KILL_REASONS } }, { $set: { revokedReason: reason } });
  }
}

/**
 * Rotates a refresh token.
 *
 * Re-presenting an already rotated token is normally a theft signal and revokes
 * the whole family. The exception (audit H1) is a short grace window for the
 * same browser: several tabs restoring a session at the same moment all send the
 * same cookie. A graced request gets its own new token in the same family,
 * provided the token was rotated (not logged out / revoked) less than
 * REFRESH_REUSE_GRACE_SECONDS ago, the user agent matches, the grace budget is
 * not exhausted and the family has not been terminated.
 */
export async function rotateRefreshToken(rawToken, { userAgent } = {}) {
  if (!rawToken) throw ApiError.unauthorized('Session expired', { code: 'NO_REFRESH_TOKEN' });
  const tokenHash = sha256(rawToken);
  const now = new Date();

  // Atomically mark as used so concurrent refreshes cannot both rotate it.
  const existing = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: null },
    { $set: { revokedAt: now, revokedReason: 'rotated' } },
    { new: false },
  );

  if (existing) {
    if (existing.expiresAt < now) throw ApiError.unauthorized('Session expired', { code: 'REFRESH_TOKEN_EXPIRED' });
    return { userId: existing.user, family: existing.family, graced: false };
  }

  const prior = await RefreshToken.findOne({ tokenHash });
  if (!prior) throw ApiError.unauthorized('Session expired', { code: 'INVALID_REFRESH_TOKEN' });

  const graceMs = env.REFRESH_REUSE_GRACE_SECONDS * 1000;
  const sameAgent = (prior.userAgent || '') === (userAgent || '').slice(0, 256);
  const recentlyRotated = prior.revokedReason === 'rotated' && prior.revokedAt && now - prior.revokedAt <= graceMs;

  if (graceMs > 0 && recentlyRotated && sameAgent && prior.expiresAt > now) {
    const familyTerminated = await RefreshToken.exists({ family: prior.family, revokedReason: { $in: FAMILY_KILL_REASONS } });
    if (!familyTerminated) {
      const budget = await RefreshToken.updateOne({ _id: prior._id, graceUses: { $lt: MAX_GRACE_USES } }, { $inc: { graceUses: 1 } });
      if (budget.modifiedCount === 1) return { userId: prior.user, family: prior.family, graced: true };
    }
  }

  // Genuine re-use of a rotated/revoked token: assume theft and end the session family.
  // The attempt itself is recorded separately so it stays auditable even when the
  // token's original revoke reason (e.g. "logout") is preserved.
  await RefreshToken.updateOne({ _id: prior._id }, { $inc: { reuseAttempts: 1 }, $set: { lastReuseAt: now } });
  await killFamily(prior.family, 'reuse', prior._id);
  throw ApiError.unauthorized('Session expired', { code: 'INVALID_REFRESH_TOKEN' });
}

/** Logout ends the whole session family (other tabs share the same cookie jar). */
export async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  const token = await RefreshToken.findOne({ tokenHash: sha256(rawToken) }, 'family').lean();
  if (token) await killFamily(token.family, 'logout', token._id);
}

export async function revokeAllForUser(userId, reason = 'password') {
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
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
