/**
 * Node server of the API, the same code everywhere:
 *  - local development (npm run dev): http://localhost:8787/api/… – Vite proxies /api here
 *  - IIS on the TUKE Plesk server: tools/build-tuke.mjs bundles this file into api.mjs, iisnode starts it
 *    through app.js and passes a named pipe (not a port number) in PORT
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { getRequestListener } from '@hono/node-server';
import { loadEnv } from '@ples/db';

const iis = Boolean(process.env.IISNODE_VERSION);
loadEnv();
if (iis) {
  // Plesk manages web.config at TUKE, so the settings live in App_Data\.env next to the bundle:
  // IIS never serves anything from App_Data
  const file = fileURLToPath(new URL('./App_Data/.env', import.meta.url));
  if (existsSync(file)) process.loadEnvFile(file);
  else console.error(`[api] ${file} not found: no database, no admin (copy App_Data/.env.example)`);
}
const { app } = await import('./app.ts');
const target = iis ? process.env.PORT! : Number(process.env.API_PORT ?? 8787);

createServer(getRequestListener(app.fetch)).listen(target, () => {
  console.log(iis ? `[api] listening on ${target} (iisnode ${process.env.IISNODE_VERSION})` : `[api] http://localhost:${target}/api/health`);
});
