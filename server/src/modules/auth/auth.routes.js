import { Router } from 'express';
import { z } from 'zod';
import { User } from '../../models/User.js';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/auth.js';
import bcrypt from 'bcryptjs';
import { authLimiter, loginAccountLimiter } from '../../middleware/rateLimit.js';
import { ApiError } from '../../lib/ApiError.js';
import { ok } from '../../lib/respond.js';
import { env } from '../../config/env.js';
import { randomToken, sha256 } from '../../lib/utils.js';
import { sendEmail, templates } from '../../lib/email.js';
import {
  REFRESH_COOKIE,
  issueRefreshToken,
  refreshCookieOptions,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from '../../lib/tokens.js';

const router = Router();

const email = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  // bcrypt only uses the first 72 bytes; longer (e.g. multi-byte) input would be silently truncated.
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

const schemas = {
  register: z.object({ name: z.string().trim().min(2, 'Name is too short').max(80), email, password }),
  login: z.object({ email, password: z.string().min(1, 'Password is required').max(128) }),
  forgot: z.object({ email }),
  reset: z.object({ token: z.string().min(20).max(200), password }),
  change: z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }),
};

async function startSession(req, res, user, family) {
  const accessToken = signAccessToken(user);
  const { token, expiresAt } = await issueRefreshToken(user, {
    family,
    userAgent: req.headers['user-agent'],
    ip: req.ip,
  });
  res.cookie(REFRESH_COOKIE, token, refreshCookieOptions(expiresAt));
  return accessToken;
}

router.post('/register', authLimiter, validate({ body: schemas.register }), async (req, res) => {
  const { name, email: mail, password: pass } = req.body;
  if (await User.exists({ email: mail })) {
    throw ApiError.conflict('An account with this email already exists', { code: 'EMAIL_IN_USE' });
  }
  const user = await User.create({ name, email: mail, password: pass, lastLoginAt: new Date() });
  const accessToken = await startSession(req, res, user);
  // Awaited: serverless platforms may freeze the function once the response is sent (audit H2).
  await sendEmail(user.email, templates.welcome(user));
  ok(res, { user: user.toPublic(), accessToken }, 201);
});

// Compared against when the email is unknown, so response time doesn't reveal which accounts exist.
let dummyHash;
const getDummyHash = async () => (dummyHash ??= await bcrypt.hash(randomToken(16), 12));

router.post('/login', authLimiter, validate({ body: schemas.login }), loginAccountLimiter, async (req, res) => {
  const user = await User.findOne({ email: req.body.email }).select('+password');
  // Same message for unknown email and wrong password to avoid account enumeration.
  if (!user) await bcrypt.compare(req.body.password, await getDummyHash());
  if (!user || !(await user.comparePassword(req.body.password))) {
    throw ApiError.unauthorized('Incorrect email or password', { code: 'INVALID_CREDENTIALS' });
  }
  if (user.isBlocked) throw ApiError.forbidden('This account has been suspended', { code: 'ACCOUNT_BLOCKED' });
  user.lastLoginAt = new Date();
  await user.save();
  const accessToken = await startSession(req, res, user);
  ok(res, { user: user.toPublic(), accessToken });
});

router.post('/refresh', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  try {
    const { userId, family } = await rotateRefreshToken(raw, { userAgent: req.headers['user-agent'] });
    const user = await User.findById(userId);
    if (!user || user.isBlocked) throw ApiError.unauthorized('Session expired', { code: 'INVALID_REFRESH_TOKEN' });
    const accessToken = await startSession(req, res, user, family);
    ok(res, { user: user.toPublic(), accessToken });
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    throw err;
  }
});

router.post('/logout', async (req, res) => {
  await revokeRefreshToken(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
  ok(res, { loggedOut: true });
});

router.get('/me', authenticate, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) throw ApiError.notFound('User not found');
  ok(res, { user: user.toPublic() });
});

router.post('/forgot-password', authLimiter, validate({ body: schemas.forgot }), async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (user && !user.isBlocked) {
    const token = randomToken(32);
    user.passwordResetTokenHash = sha256(token);
    user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();
    await sendEmail(
      user.email,
      templates.passwordReset(user, `${env.clientUrl}/reset-password?token=${encodeURIComponent(token)}`),
    );
  }
  // Always respond identically so the endpoint can't be used to discover accounts.
  ok(res, { message: 'If an account exists for that email, a reset link has been sent.' });
});

router.post('/reset-password', authLimiter, validate({ body: schemas.reset }), async (req, res) => {
  const user = await User.findOne({
    passwordResetTokenHash: sha256(req.body.token),
    passwordResetExpiresAt: { $gt: new Date() },
  }).select('+passwordResetTokenHash +passwordResetExpiresAt');
  if (!user) throw ApiError.badRequest('This reset link is invalid or has expired', { code: 'INVALID_RESET_TOKEN' });

  user.password = req.body.password;
  user.passwordResetTokenHash = undefined;
  user.passwordResetExpiresAt = undefined;
  user.tokenVersion += 1;
  await user.save();
  await revokeAllForUser(user._id);
  ok(res, { message: 'Password updated. Please sign in with your new password.' });
});

router.post('/change-password', authenticate, validate({ body: schemas.change }), async (req, res) => {
  const user = await User.findById(req.user.id).select('+password');
  if (!user || !(await user.comparePassword(req.body.currentPassword))) {
    throw ApiError.badRequest('Current password is incorrect', { code: 'INVALID_PASSWORD' });
  }
  user.password = req.body.newPassword;
  user.tokenVersion += 1;
  await user.save();
  await revokeAllForUser(user._id);
  const accessToken = await startSession(req, res, user);
  ok(res, { message: 'Password changed. Other sessions were signed out.', accessToken });
});

export default router;
