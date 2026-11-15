import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 30 },
    description: { type: String, trim: true, maxlength: 200, default: '' },
    type: { type: String, enum: ['percent', 'flat'], required: true },
    value: { type: Number, required: true, min: 1 },
    maxDiscount: { type: Number, min: 0 }, // cap for percentage coupons
    minOrderValue: { type: Number, min: 0, default: 0 },
    startsAt: { type: Date },
    expiresAt: { type: Date },
    usageLimit: { type: Number, min: 1 }, // global
    perUserLimit: { type: Number, min: 1, default: 1 },
    usedCount: { type: Number, min: 0, default: 0 },
    usedBy: [
      {
        _id: false,
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        count: { type: Number, default: 0 },
      },
    ],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

couponSchema.index({ isActive: 1, expiresAt: 1 });

export const Coupon = mongoose.models.Coupon || mongoose.model('Coupon', couponSchema);
