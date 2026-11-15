import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDB } from './config/db.js';
import { redisHealthy } from './config/redis.js';
import { sanitizeInput } from './middleware/sanitize.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/error.js';
import paymentRoutes from './modules/payments/payment.routes.js';
import v1 from './routes/v1.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Vercel / load balancer: needed for correct req.ip and rate limiting
  app.set('query parser', 'extended');

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.headers['x-request-id'] || randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      customSuccessMessage: (req, res, ms) => `${req.method} ${req.originalUrl || req.url} ${res.statusCode} ${Math.round(ms)}ms`,
      customErrorMessage: (req, res, err) => `${req.method} ${req.originalUrl || req.url} ${res.statusCode} - ${err.message}`,
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin(origin, cb) {
        // Same-origin / server-to-server requests have no Origin header.
        if (!origin || env.corsOrigins.includes(origin.replace(/\/$/, ''))) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
      maxAge: 600,
    }),
  );

  app.use(compression());

  // Health check does not touch rate limiting or the request body.
  app.get('/api/health', async (_req, res) => {
    let db = 'disconnected';
    try {
      await connectDB();
      db = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    } catch {
      db = 'error';
    }
    res.status(db === 'connected' ? 200 : 503).json({
      success: db === 'connected',
      data: {
        status: db === 'connected' ? 'ok' : 'degraded',
        version: 'v1',
        db,
        cache: redisHealthy() ? 'redis' : 'memory',
        payments: env.paymentsEnabled ? 'razorpay' : 'disabled',
        email: env.emailEnabled ? 'smtp' : 'log-only',
        uptime: Math.round(process.uptime()),
      },
    });
  });

  // Ensure a DB connection for every API request (cached; cheap after the first call).
  app.use('/api', async (_req, _res, next) => {
    await connectDB();
    next();
  });

  // Webhooks need the raw body for signature verification -> mount before JSON parsing.
  app.use('/api/v1/payments', paymentRoutes);

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());
  app.use(sanitizeInput);

  app.use('/api', apiLimiter);
  app.use('/api/v1', v1);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
