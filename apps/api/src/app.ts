import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getDb, isDatabaseConfigured, resolveDriver } from '@ples/db';
import { sql } from 'drizzle-orm';
import { ApiFailure } from './lib/http.ts';
import { ensureSecret } from './lib/security.ts';
import { adminRoutes } from './routes/admin.ts';
import { eventRoutes } from './routes/events.ts';
import { feedbackRoutes } from './routes/feedback.ts';
import { gazetteerRoutes } from './routes/gazetteer.ts';
import { globe } from './routes/globe.ts';

export const app = new Hono().basePath('/api');

app.use('*', async (c, next) => {
  if (/^\/api\/(events|feedback|admin)(\/|$)/.test(c.req.path)) await ensureSecret();
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
});

app.get('/health', async c => {
  let database: 'up' | 'down' | 'not_configured' = 'not_configured';
  if (isDatabaseConfigured()) {
    try { await (await getDb()).execute(sql`select 1`); database = 'up'; } catch { database = 'down'; }
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, database, driver: isDatabaseConfigured() ? resolveDriver() : null, commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null });
});

app.route('/globe', globe);
app.route('/gazetteer', gazetteerRoutes);
app.route('/events', eventRoutes);
app.route('/feedback', feedbackRoutes);
app.route('/admin', adminRoutes);

app.notFound(c => c.json({ error: { code: 'not_found', message: 'Neznáma adresa API.' } }, 404));

app.onError((err, c) => {
  if (err instanceof ApiFailure) return c.json({ error: { code: err.code, message: err.message } }, err.status);
  if (err instanceof HTTPException) return c.json({ error: { code: 'http_error', message: err.message } }, err.status);
  console.error('[api]', c.req.method, c.req.path, err);
  return c.json({ error: { code: 'server_error', message: 'Na serveri sa niečo pokazilo. Skús to znova.' } }, 500);
});
