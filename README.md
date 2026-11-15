<div align="center">

# 📚 Shelfify

### A production-grade MERN bookstore

React 19 · Vite · Tailwind CSS 4 · Node.js · Express 5 · MongoDB · Razorpay · Vercel

</div>

---

## Overview

Shelfify is a full-stack e-commerce bookstore: product discovery with full-text search and faceted filters, a persistent guest/account cart, wishlist, reviews, coupons, Razorpay checkout with server-side payment verification, order tracking, transactional email, personalised recommendations and an admin console with sales analytics and inventory management.

## Architecture

```
                         ┌──────────────── Vercel project ────────────────┐
 Browser ── HTTPS ──────▶│  /            static SPA  (client/dist)        │
 (React SPA)             │  /api/*  ──▶  serverless fn  api/index.js       │
   ▲   httpOnly          │                 └─ Express app (server/src)     │
   │   refresh cookie    └────────────┬───────────────┬────────────┬──────┘
   │   (same origin)                  │               │            │
   │                           MongoDB Atlas    Redis (optional)  SMTP (optional)
   └──── Razorpay Checkout ◀── Razorpay API ──── webhooks ──▶ /api/v1/payments/webhook
```

* **One origin**: the SPA and API share a domain, so the refresh token is an `HttpOnly; Secure; SameSite=Lax` cookie with no cross-site CORS surface.
* **Stateless API**: the cached Mongo connection and Redis-backed cache and rate limits work on serverless and on a long-running Node process (`npm start`).

### Backend (`server/`)

| Area | Implementation |
|---|---|
| Structure | `config/` (validated env, logger, db, redis) · `middleware/` · `models/` · `modules/<domain>/` routes and services · `/api/v1` versioned router |
| Auth | 15-minute JWT access token (memory only) plus opaque rotating refresh tokens (SHA-256 hashed, family-based **reuse detection**). `tokenVersion` revokes sessions on password change, role change or block |
| Authorization | `authenticate` / `authorize('admin')` RBAC; ownership checks on orders and reviews |
| Validation | Zod schemas for body, query and params; NoSQL-operator sanitiser; 100 kb body limit |
| Errors | `ApiError` plus one central handler returning `{ success, error: { code, message, details }, requestId }` |
| Payments | Server-computed totals → Razorpay order → **HMAC signature verification** (timing-safe) → idempotent `markPaid`. Signed **webhooks** with event de-duplication. Automatic refunds on cancellation |
| Orders | `Idempotency-Key` header on checkout · atomic **stock reservation** with compensation · 30-minute reservation expiry (sweeper and Vercel Cron) · enforced status state machine · tracking info |
| Data | Indexes for text search (weighted), filters and sorts, order lookups, TTL indexes for refresh tokens and webhook events |
| Performance | Read-through cache (Redis, falling back to in-process LRU) with namespace-version invalidation · `lean()` queries · `$text` search with regex prefix fallback · compression · HTTP cache headers |
| Security | helmet, strict CORS allow-list, rate limits (global / auth / payment), bcrypt cost 12, redacted structured logs (pino) with request IDs |
| Email | Welcome, password reset, order confirmation and shipping/delivery/cancellation updates (nodemailer; logs only when SMTP is not configured) |
| Recommendations | Content-based ("more like this"), collaborative ("frequently bought together") and a personalised affinity model built from purchases, wishlist and cart |

### Frontend (`client/`)

Vite + React 19 with React Router 7 (lazy routes; the admin bundle and charts load only for admins), TanStack Query for server state, contexts for auth, cart, wishlist and toasts, Tailwind CSS 4 design tokens (Fraunces + Inter, warm paper palette), Framer Motion and Recharts. Every page has loading skeletons, error states with retry, empty states and a mobile layout.

Pages: Home · Shop (URL-driven filters, sort and pagination, mobile filter drawer, live search suggestions) · Book detail (reviews, recommendations) · Bag · Checkout · Orders and tracking · Wishlist · Account (profile, addresses, security) · Auth (sign-in, register, forgot/reset password) · Admin (overview analytics, orders, catalog, inventory, coupons, customers).

## Local development

Requires Node.js 20.19+.

```bash
npm run install:all          # installs server/ and client/
cp server/.env.example server/.env   # then set JWT_ACCESS_SECRET and SEED_ADMIN_* (MONGODB_URI optional)
npm run dev                  # API on :5000 + web on http://localhost:5173 (Ctrl+C stops both)
```

`npm run dev` uses `MONGODB_URI` from `server/.env` when set (e.g. MongoDB Atlas). When it's empty, it starts a **persistent local MongoDB** with its data in `server/.data/` (git-ignored). Either way it seeds the catalog, coupons and admin account idempotently, and restarts the API when files in `server/src` change.

| Command | Purpose |
|---|---|
| `npm run db:check` | Verify `MONGODB_URI` connectivity and permissions, with fix-it hints |
| `npm run dev:api:memory` | Throwaway in-memory database (data discarded on exit) |
| `npm run dev:api` / `npm run dev:web` | Run API or web separately |

## Testing

```bash
npm test                     # 65 server tests (Vitest + Supertest + in-memory MongoDB / replica set)
npm run build                # production client build
```

| Suite | Covers |
|---|---|
| `api.test.js` | Auth, RBAC, NoSQL-injection stripping, catalog, cart and coupons, guest-cart merge, checkout idempotency, oversell prevention, forged signatures, webhooks, cancellation and refunds, reservation expiry, order privacy, reviews. Runs on a standalone server (the no-transaction fallback). |
| `orders-reliability.test.js` | Real transactions on a replica set: concurrent checkout without overselling, rollback after crashes, coupon reservation under concurrency, crash-safe fulfilment that runs exactly once, retries of emails and refunds |
| `auth-sessions.test.js` | Multi-tab refresh grace window, theft detection, logout/password revocation, per-account login throttling |
| `redis.test.js` | An unreachable Redis can't crash or stall the API; rate limits and cache invalidation shared across instances; mid-request fallback |
| `security.test.js` | Fail-closed production config, Zod 4 partial-update safety, http(s)-only URLs, webhook raw-body handling, health exposure, request IDs, cache headers |

## Deployment (Vercel)

1. Create a MongoDB Atlas cluster in **AWS Mumbai (ap-south-1)** to match the function region `bom1` in `vercel.json`. Allow network access from Vercel (`0.0.0.0/0`, or static IPs on paid plans). Atlas is always a replica set, so checkout runs in real transactions.
2. Create an **Upstash Redis** database (ap-south-1) and copy its `rediss://` TCP URL into `REDIS_URL`. This shares rate limits and cache invalidation across serverless instances.
3. Import this folder as a Vercel project with the **root directory** set to this folder. `vercel.json` configures install, build, output, the `/api` function, the region, SPA rewrites, security headers and the daily maintenance cron.
4. Add the environment variables from `server/.env.example`: `MONGODB_URI`, `JWT_ACCESS_SECRET` (strong, random), an https `CLIENT_URL`, `CRON_SECRET`, `REDIS_URL` and `NODEJS_HELPERS=0`, plus `RAZORPAY_*` to enable payments and `SMTP_*` for email. The API refuses to start if a required value is missing or weak.
5. Seed once from your machine, and again after any deploy that adds indexes (production skips index builds at cold start): `MONGODB_URI=… SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… npm run seed`.
6. In Razorpay, add the webhook `https://<domain>/api/v1/payments/webhook` with the events listed in `.env.example`.

## API

Base path: `/api/v1`. Health check: `GET /api/health`.

`auth` (register, login, refresh, logout, me, forgot-password, reset-password, change-password) · `products` (list, collections, facets, suggest, recommendations, `:slug`, related, also-bought, reviews) · `cart` (get, items CRUD, merge, quote) · `wishlist` · `orders` (checkout, list, detail, pay, verify, cancel) · `payments` (config, webhook) · `users/me` (profile, addresses) · `coupons/available` · `admin` (analytics, products, stock, orders/status, coupons, users).

## Project history

The original Create React App frontend is preserved unchanged in `client/legacy-cra/`, along with the original README.

---

## 👨‍💻 Author

<div align="center">

### Anumodit Shukla

<a href="https://github.com/anumodit740">
  <img src="https://img.shields.io/badge/GitHub-anumodit740-black?style=for-the-badge&logo=github" />
</a>

<a href="https://leetcode.com/luciferV">
  <img src="https://img.shields.io/badge/LeetCode-luciferV-orange?style=for-the-badge&logo=leetcode" />
</a>

<a href="https://www.geeksforgeeks.org/user/anumoditsh740/">
  <img src="https://img.shields.io/badge/GeeksforGeeks-anumoditsh740-2F8D46?style=for-the-badge&logo=geeksforgeeks" />
</a>

</div>

---

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:00c6ff,100:0072ff&height=120&section=footer"/>

</div>

