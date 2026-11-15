import readline from 'node:readline';

/**
 * Terminal prompts with hidden input for secrets.
 * Interactive terminals echo keystrokes, so hidden prompts mask them with '*';
 * non-interactive (piped) input never echoes anything. A line queue makes it
 * work whether lines are typed one by one or arrive all at once.
 */
export function createPrompt() {
  const interactive = Boolean(process.stdin.isTTY);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: interactive });
  let muted = false;
  rl._writeToOutput = (s) => {
    if (!muted) rl.output.write(s);
    else if (s.includes('\n') || s.includes('\r')) rl.output.write('\n');
    else rl.output.write('*'.repeat(s.length));
  };

  const queued = [];
  let waiter = null;
  let closed = false;
  rl.on('line', (line) => (waiter ? (waiter(line), (waiter = null)) : queued.push(line)));
  rl.on('close', () => {
    closed = true;
    if (waiter) waiter(null);
  });
  const nextLine = () => (queued.length ? Promise.resolve(queued.shift()) : closed ? Promise.resolve(null) : new Promise((r) => (waiter = r)));

  return {
    async ask(question) {
      rl.output.write(question);
      return ((await nextLine()) ?? '').trim();
    },
    async askHidden(question) {
      rl.output.write(question);
      muted = true;
      const answer = (await nextLine()) ?? '';
      muted = false;
      if (!interactive) rl.output.write('\n');
      return answer;
    },
    close: () => rl.close(),
  };
}

/** Replaces (or appends) exactly one KEY=value line; returns the new file text. */
export function setEnvLine(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, () => `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
}
