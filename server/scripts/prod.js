/**
 * Runs a maintenance script against PRODUCTION configuration only.
 *
 *   node scripts/prod.js <env|db|seed> [flags]
 *
 * It loads server/.env.production.local (git-ignored, excluded from Vercel uploads)
 * and deliberately NOT server/.env, so local-only values such as the local admin
 * password can never leak into production commands. Secrets are never printed.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env.production.local');
const targets = {
  env: './check-env.js',
  db: './check-db.js',
  seed: './seed.js',
};

const [command, ...rest] = process.argv.slice(2);
if (!targets[command]) {
  console.error(`Usage: node scripts/prod.js <${Object.keys(targets).join('|')}> [flags]`);
  process.exit(1);
}
if (!existsSync(envFile)) {
  console.error('server/.env.production.local not found. Run "npm run prod:init" first.');
  process.exit(1);
}

// Refuse to run if the secrets file could be committed.
try {
  execFileSync('git', ['check-ignore', '-q', envFile], { cwd: root, stdio: 'ignore' });
} catch {
  console.error('Refusing to continue: server/.env.production.local is NOT git-ignored.');
  process.exit(1);
}

// dotenv/config (imported by the target and by src/config/env.js) honours this path,
// so ONLY the production file is loaded - never server/.env.
process.env.DOTENV_CONFIG_PATH = envFile;
process.argv = [process.argv[0], path.join(root, 'scripts', targets[command]), ...rest];
await import(targets[command]);
