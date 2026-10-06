import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';

export class ApiFailure extends Error {
  constructor(readonly status: ContentfulStatusCode, readonly code: string, message: string) { super(message); }
}

export const fail = (status: ContentfulStatusCode, code: string, message: string): never => { throw new ApiFailure(status, code, message); };

/** Response caching on the Vercel CDN (s-maxage) and in the browser (max-age). */
export const CACHE = {
  dataset: 'public, max-age=60, s-maxage=3600, stale-while-revalidate=604800',
  dictionary: 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
  summary: 'public, max-age=0, s-maxage=5, stale-while-revalidate=30',
  /** same response for every viewer: the CDN answers almost every poll, the function runs about once per 2 s */
  live: 'public, max-age=0, s-maxage=2, stale-while-revalidate=2',
  none: 'no-store',
} as const;

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
