import pino from 'pino';
import { env } from './env.js';

// Pretty logs for local development (TTY, or when piped by the dev runner via LOG_PRETTY=true).
const usePretty = !env.isProd && !env.isTest && (process.stdout.isTTY || process.env.LOG_PRETTY === 'true');

export const logger = pino({
  level: env.LOG_LEVEL || (env.isTest ? 'silent' : env.isProd ? 'info' : 'debug'),
  base: { service: 'shelfify-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.refreshToken',
      '*.razorpay_signature',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(usePretty
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service,req,res,responseTime', singleLine: true } } }
    : {}),
});
