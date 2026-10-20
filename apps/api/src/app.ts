import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { getDb, isDatabaseConfigured, sql } from '@ples/db';
import { ApiFailure } from './lib/http.ts';
import { ensureSecret } from './lib/security.ts';
import { adminRoutes } from './routes/admin.ts';
import { eventRoutes } from './routes/events.ts';
import { feedbackRoutes } from './routes/feedback.ts';
import { gazetteerRoutes } from './routes/gazetteer.ts';
import { globe } from './routes/globe.ts';

export const app = new Hono().basePath('/api');

/**
 * WEB_ORIGIN: origins of the web app when it runs on another host than the API, comma separated
 * (e.g. https://srdcom.tuke.sk). The web then calls the API with credentials (admin cookie), so the
 * allowed origins are listed exactly. Unset = same origin (local development, the Vite proxy).
 * Every request of the web carries x-device-id, so browsers send a preflight; max-age lets them reuse it.
 */
const webOrigins = (process.env.WEB_ORIGIN ?? '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
if (webOrigins.length) {
  app.use('*', cors({
    origin: webOrigins,
    credentials: true,
    allowHeaders: ['content-type', 'x-device-id'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }));
}

app.use('*', async (c, next) => {
  if (/^\/api\/(events|feedback|admin)(\/|$)/.test(c.req.path)) await ensureSecret();
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
});

app.get('/health', async c => {
  let database: 'up' | 'down' | 'not_configured' = 'not_configured';
  if (isDatabaseConfigured()) {
    try { await sql`select 1`.execute(await getDb()); database = 'up'; } catch { database = 'down'; }
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true, database, driver: isDatabaseConfigured() ? 'mssql' : null, commit: process.env.APP_COMMIT ?? null });
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
