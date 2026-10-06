/** Local development server (npm run dev): http://localhost:8787/api/… – Vite proxies /api here. */
import { serve } from '@hono/node-server';
import { loadEnv } from '@ples/db';

loadEnv();
const { app } = await import('./app.ts');
const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port }, info => console.log(`[api] http://localhost:${info.port}/api/health`));
