import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { VENUES, VENUE_KEYS, type VenueKey } from '@ples/shared';
import { getDb, isDatabaseConfigured, sql } from '@ples/db';
import { ApiFailure } from './lib/http.ts';
import { ensureSecret } from './lib/security.ts';
import { routeOf } from './lib/venue.ts';
import { adminRoutes } from './routes/admin.ts';
import { eventRoutes } from './routes/events.ts';
import { feedbackRoutes } from './routes/feedback.ts';
import { gateRoutes } from './routes/gate.ts';
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
  if (/^\/(events|feedback|admin|gate)(\/|$)/.test(routeOf(c).route)) await ensureSecret();
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
});

async function databaseState(venue: VenueKey): Promise<'up' | 'down' | 'not_configured'> {
  if (!isDatabaseConfigured(venue)) return 'not_configured';
  try { await sql`select 1`.execute(await getDb(venue)); return 'up'; } catch { return 'down'; }
}

/**
 * The same routes for every venue, each on its own database: /api/… for the ball, /api/vestibul/… for the
 * student lobby (VENUES in packages/shared). The handlers find their venue from the path (lib/venue.ts).
 */
for (const venue of Object.values(VENUES)) {
  const base = venue.prefix;
  app.get(`${base}/health`, async c => {
    const states = await Promise.all(VENUE_KEYS.map(databaseState));
    const databases = Object.fromEntries(VENUE_KEYS.map((key, i) => [key, states[i]!])) as Record<VenueKey, (typeof states)[number]>;
    c.header('Cache-Control', 'no-store');
    return c.json({
      ok: true, venue: venue.key, database: databases[venue.key], databases,
      driver: isDatabaseConfigured(venue.key) ? 'mssql' : null, commit: process.env.APP_COMMIT ?? null,
    });
  });
  app.route(`${base}/gate`, gateRoutes);
  app.route(`${base}/globe`, globe);
  app.route(`${base}/gazetteer`, gazetteerRoutes);
  app.route(`${base}/events`, eventRoutes);
  app.route(`${base}/feedback`, feedbackRoutes);
  app.route(`${base}/admin`, adminRoutes);
}

app.notFound(c => c.json({ error: { code: 'not_found', message: 'Neznáma adresa API.' } }, 404));

app.onError((err, c) => {
  if (err instanceof ApiFailure) return c.json({ error: { code: err.code, message: err.message } }, err.status);
  if (err instanceof HTTPException) return c.json({ error: { code: 'http_error', message: err.message } }, err.status);
  console.error('[api]', c.req.method, c.req.path, err);
  return c.json({ error: { code: 'server_error', message: 'Na serveri sa niečo pokazilo. Skús to znova.' } }, 500);
});
