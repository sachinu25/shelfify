import { z } from 'zod';

/**
 * Builds a PATCH schema from a create schema: every field optional and, crucially,
 * WITHOUT defaults. Zod 4 applies `.default()` values even to keys missing from a
 * `.partial()` object, so `{ price: 100 }` would otherwise also reset stock,
 * visibility, description, etc. to their defaults.
 */
export function toPatchSchema(objectSchema) {
  const shape = {};
  for (const [key, field] of Object.entries(objectSchema.shape)) {
    let inner = field;
    while (inner instanceof z.ZodDefault || inner instanceof z.ZodPrefault) inner = inner.unwrap();
    shape[key] = inner.optional();
  }
  return z.object(shape);
}

/** Absolute http(s) URL only - rejects javascript:, data:, file:, etc. */
export const httpUrl = (message = 'Must be a valid http(s) URL', max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => {
      try {
        const u = new URL(value);
        return (u.protocol === 'https:' || u.protocol === 'http:') && Boolean(u.hostname);
      } catch {
        return false;
      }
    }, message);
