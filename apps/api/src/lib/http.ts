import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

export class ApiFailure extends Error {
  constructor(readonly status: ContentfulStatusCode, readonly code: string, message: string) { super(message); }
}

export const fail = (status: ContentfulStatusCode, code: string, message: string): never => { throw new ApiFailure(status, code, message); };

/**
 * Response caching in the browser (max-age) and in a shared cache, if one sits in front of the API (s-maxage).
 * With the web on another origin every response also carries Vary: Origin (CORS middleware in app.ts).
 */
export const CACHE = {
  dataset: 'public, max-age=60, s-maxage=3600, stale-while-revalidate=604800',
  dictionary: 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
  /**
   * The polled feeds are never served stale by the browser: with stale-while-revalidate (left from the Vercel CDN)
   * Chrome answered the wall's resync during a burst of lights with a summary up to 30 s old, and lights and counters
   * fell back (load test 2026-10-27). Same response for every viewer, see shared().
   */
  summary: 'public, max-age=0, s-maxage=2',
  live: 'public, max-age=0, s-maxage=2',
  none: 'no-store',
} as const;

/**
 * Computes a value at most once per ttl and hands the same result to every caller in the meantime.
 * The live feed and the summary are identical for all viewers: on Vercel the CDN answered the polls,
 * on IIS this keeps the database load flat however many screens and phones poll.
 */
export function shared<T>(ttlMs: number): (key: string, compute: () => Promise<T>) => Promise<T> {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return (key, compute) => {
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value;
    const value = compute();
    entries.set(key, { at: now, value });
    value.catch(() => { if (entries.get(key)?.value === value) entries.delete(key); }); // never keep a failure
    return value;
  };
}

/** Positive whole number from a query or path parameter, else undefined. */
export function positiveInt(value: string | undefined): number | undefined {
  if (!value || !/^\d{1,9}$/.test(value)) return undefined;
  const n = Number(value);
  return n > 0 ? n : undefined;
}

export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try { body = await c.req.json(); } catch { fail(400, 'invalid_json', 'Telo požiadavky nie je platný JSON.'); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    fail(400, 'invalid_input', `Neplatné údaje${issue ? ` (${issue.path.join('.') || 'telo'}: ${issue.message})` : ''}.`);
  }
  return parsed.data as z.infer<S>;
}
