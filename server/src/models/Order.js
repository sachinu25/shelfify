import mongoose from 'mongoose';

export const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'payment_failed',
  'expired',
  'refunded',
];

/** Allowed forward transitions for admin fulfilment workflow. */
export const STATUS_TRANSITIONS = {
  pending_payment: ['paid', 'payment_failed', 'expired', 'cancelled'],
  payment_failed: ['paid', 'expired', 'cancelled'],
  paid: ['processing', 'shipped', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered'],
  delivered: ['refunded'],
  cancelled: ['refunded'],
  expired: [],
  refunded: [],
};

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    title: { type: String, required: true },
    author: String,
    slug: String,
    coverImage: String,
    price: { type: Number, required: true, min: 0 },
    mrp: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: { type: [orderItemSchema], validate: (v) => v.length > 0 },
    shippingAddress: {
      fullName: String,
      phone: String,
      line1: String,
      line2: String,
      city: String,
      state: String,
      postalCode: String,
      country: String,
    },
    pricing: {
      subtotal: { type: Number, required: true },
      mrpTotal: { type: Number, required: true },
      couponDiscount: { type: Number, default: 0 },
      shipping: { type: Number, default: 0 },
      total: { type: Number, required: true },
      currency: { type: String, default: 'INR' },
    },
    coupon: { code: String, couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon' } },
    status: { type: String, enum: ORDER_STATUSES, default: 'pending_payment' },
    statusHistory: [
      {
        _id: false,
        status: { type: String, enum: ORDER_STATUSES },
        at: { type: Date, default: Date.now },
        note: String,
        by: { type: String, enum: ['system', 'customer', 'admin', 'webhook'], default: 'system' },
      },
    ],
    payment: {
      provider: { type: String, default: 'razorpay' },
      razorpayOrderId: String,
      razorpayPaymentId: String,
      method: String,
      paidAt: Date,
      failureReason: String,
      refundId: String,
      refundStatus: String,
    },
    tracking: { carrier: String, number: String, url: String },
    idempotencyKey: { type: String, maxlength: 100 },
    stockReserved: { type: Boolean, default: false },
    reservationExpiresAt: Date,
    couponRedeemed: { type: Boolean, default: false },
    emailSent: { type: Boolean, default: false },
  },
  { timestamps: true },
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'payment.razorpayOrderId': 1 }, { unique: true, sparse: true });
orderSchema.index(
  { user: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
orderSchema.index({ status: 1, reservationExpiresAt: 1 });
orderSchema.index({ 'items.product': 1 });

export const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
