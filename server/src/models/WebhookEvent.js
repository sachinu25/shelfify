import mongoose from 'mongoose';

/** De-duplicates provider webhook deliveries (Razorpay retries on non-2xx / timeouts). */
const webhookEventSchema = new mongoose.Schema(
  {
    provider: { type: String, default: 'razorpay' },
    eventId: { type: String, required: true, unique: true },
    event: String,
    processedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

webhookEventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const WebhookEvent = mongoose.models.WebhookEvent || mongoose.model('WebhookEvent', webhookEventSchema);
