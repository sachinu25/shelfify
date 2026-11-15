// Vercel Serverless Function: all /api/* traffic is rewritten here (see vercel.json).
// The Express app lives in /server and is shared with the long-running local server.
import { createApp } from '../server/src/app.js';

const app = createApp();

export default app;
