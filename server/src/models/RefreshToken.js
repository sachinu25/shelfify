import mongoose from 'mongoose';

export const REVOKE_REASONS = ['rotated', 'logout', 'reuse', 'password', 'admin'];
/** Reasons that end the whole session family (no grace re-use allowed afterwards). */
export const FAMILY_KILL_REASONS = ['logout', 'reuse', 'password', 'admin'];

const refreshTokenSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, enum: [...REVOKE_REASONS, null], default: null },
    // How many times this (already rotated) token was accepted inside the grace window.
    graceUses: { type: Number, default: 0 },
    // Audit trail for presentations of an already revoked/rotated token (theft signal).
    reuseAttempts: { type: Number, default: 0 },
    lastReuseAt: { type: Date, default: null },
    userAgent: String,
    ip: String,
  },
  { timestamps: true },
);

// MongoDB TTL monitor removes expired tokens automatically.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ family: 1, revokedReason: 1 });

export const RefreshToken = mongoose.models.RefreshToken || mongoose.model('RefreshToken', refreshTokenSchema);
