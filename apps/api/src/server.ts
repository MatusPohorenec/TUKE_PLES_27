/**
 * Node server of the API, the same code everywhere:
 *  - local development (npm run dev): http://localhost:8787/api/… – Vite proxies /api here
 *  - IIS on the TUKE Plesk server: tools/build-tuke.mjs bundles this file into api.mjs, iisnode starts it
 *    through app.js and passes a named pipe (not a port number) in PORT
 */
import { createServer } from 'node:http';
import { getRequestListener } from '@hono/node-server';
import { loadEnv } from '@ples/db';

loadEnv();
const { app } = await import('./app.ts');
const iis = Boolean(process.env.IISNODE_VERSION);
const target = iis ? process.env.PORT! : Number(process.env.API_PORT ?? 8787);

createServer(getRequestListener(app.fetch)).listen(target, () => {
  console.log(iis ? `[api] listening on ${target} (iisnode ${process.env.IISNODE_VERSION})` : `[api] http://localhost:${target}/api/health`);
});
