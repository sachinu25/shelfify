// Vercel Serverless Function entry: every /api/* request is routed here (see vercel.json).
import { createApp } from '../src/app.js';

const app = createApp();

export default app;
