import { readFileSync } from 'node:fs';

/**
 * Detects values that dotenv would load differently from how they are written.
 * In unquoted values "#" starts a comment, so `KEY=Abc#123` silently loads "Abc";
 * double-quoted values expand escapes like \n. Never returns or prints the value.
 *
 * @returns {null | string} null when the loaded value equals what was written,
 *   otherwise a human-readable reason (no secret content).
 */
export function loadedDiffersFromWritten(file, key, loaded) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  if (line === undefined) return null;
  const raw = line.slice(key.length + 1).trim();
  let intended = raw;
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    intended = raw.slice(1, -1);
    if (intended.includes("'")) return "the value contains a single quote inside single quotes - choose a value without ' characters";
  } else if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    intended = raw.slice(1, -1);
    if (intended.includes('\\')) return 'backslashes inside double quotes are interpreted as escapes - use single quotes instead';
  } else if (raw.includes('#')) {
    return 'an unquoted "#" starts a comment, so everything after it is cut off - wrap the whole value in single quotes';
  }
  if ((loaded ?? '') !== intended) return 'the loaded value does not match what is written (check quoting) - wrap the whole value in single quotes';
  return null;
}
