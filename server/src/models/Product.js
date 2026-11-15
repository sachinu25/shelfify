import mongoose from 'mongoose';
import slugify from 'slugify';
import { randomToken } from '../lib/utils.js';

export const GENRES = ['fiction', 'thriller', 'romance', 'philosophy', 'manga', 'tech', 'self-help', 'biography', 'history', 'children'];

const productSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    author: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    genre: { type: String, required: true, lowercase: true, trim: true, enum: GENRES },
    price: { type: Number, required: true, min: 0 }, // selling price (INR)
    mrp: { type: Number, required: true, min: 0 }, // list price (INR)
    coverImage: { type: String, trim: true, maxlength: 500, default: '' },
    badge: { type: String, trim: true, maxlength: 30, default: '' },
    publisher: { type: String, trim: true, maxlength: 120 },
    language: { type: String, trim: true, maxlength: 40, default: 'English' },
    pages: { type: Number, min: 1 },
    isbn: { type: String, trim: true, maxlength: 20 },
    publishedYear: { type: Number, min: 1000, max: 3000 },
    stock: { type: Number, required: true, min: 0, default: 0 },
    lowStockThreshold: { type: Number, min: 0, default: 5 },
    fastDelivery: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    // Denormalised aggregates maintained by review / order services.
    ratingAverage: { type: Number, min: 0, max: 5, default: 0 },
    ratingCount: { type: Number, min: 0, default: 0 },
    soldCount: { type: Number, min: 0, default: 0 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

productSchema.virtual('discountPercent').get(function discountPercent() {
  if (!this.mrp || this.mrp <= this.price) return 0;
  return Math.round(((this.mrp - this.price) / this.mrp) * 100);
});

productSchema.virtual('inStock').get(function inStock() {
  return this.stock > 0;
});

productSchema.pre('validate', function ensureSlug() {
  if (!this.slug && this.title) {
    this.slug = `${slugify(this.title, { lower: true, strict: true })}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  }
  if (this.mrp < this.price) this.mrp = this.price;
});

// Discovery indexes
productSchema.index(
  { title: 'text', author: 'text', description: 'text' },
  { weights: { title: 10, author: 6, description: 1 }, name: 'product_text' },
);
productSchema.index({ isActive: 1, genre: 1, price: 1 });
productSchema.index({ isActive: 1, createdAt: -1 });
productSchema.index({ isActive: 1, ratingAverage: -1, ratingCount: -1 });
productSchema.index({ isActive: 1, soldCount: -1 });
productSchema.index({ author: 1 });
productSchema.index({ stock: 1 });

export const Product = mongoose.models.Product || mongoose.model('Product', productSchema);
