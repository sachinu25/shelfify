/**
 * Starts the API (server, persistent local DB or Atlas) and the web client together.
 *   npm run dev
 * Ctrl+C stops both.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const colors = { api: '\x1b[35m', web: '\x1b[36m' };

function run(name, cwd, script) {
  // Single command string (no args array) so shell mode doesn't trigger Node's DEP0190 warning.
  const child = spawn(`${npm} run ${script}`, { cwd: path.join(root, cwd), shell: true, env: process.env });
  const prefix = `${colors[name]}[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      lines.forEach((l) => out.write(`${prefix}${l}\n`));
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`${prefix}exited (${code})`);
    shutdown();
  });
  return child;
}

const children = [run('api', 'server', 'dev:local'), run('web', 'client', 'dev')];
let done = false;
function shutdown() {
  if (done) return;
  done = true;
  children.forEach((c) => c.kill('SIGINT'));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
