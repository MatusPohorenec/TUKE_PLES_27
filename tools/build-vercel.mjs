// Vercel Build Output API v3 (https://vercel.com/docs/build-output-api/v3):
//   .vercel/output/static/          the built web app (apps/web/dist)
//   .vercel/output/functions/api.func/  the API bundled into one ESM file + the dataset snapshot
//   .vercel/output/config.json      routes: /api/* -> function, static files, SPA fallback to index.html
// The API bundle is a plain Node handler, so the same build runs on any Node server outside Vercel.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = `${root}.vercel/output`;
const fn = `${out}/functions/api.func`;

rmSync(out, { recursive: true, force: true });
mkdirSync(fn, { recursive: true });

execSync('npm run build -w @ples/web', { cwd: root, stdio: 'inherit' });
cpSync(`${root}apps/web/dist`, `${out}/static`, { recursive: true });

await build({
  entryPoints: [`${root}apps/api/src/vercel.ts`],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  // PGlite is the local development database only; pg-native is an optional addon of pg
  external: ['@electric-sql/pglite', '@electric-sql/pglite/*', 'pg-native'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
cpSync(`${root}data/tuke_cooperation.json`, `${fn}/tuke_cooperation.json`);

writeFileSync(`${fn}/.vc-config.json`, JSON.stringify({
  runtime: 'nodejs22.x',
  handler: 'index.mjs',
  launcherType: 'Nodejs',
  shouldAddHelpers: false,
  supportsResponseStreaming: true,
  maxDuration: 30,
  regions: ['fra1'], // Frankfurt, next to the Neon database (aws-eu-central-1)
}, null, 2));

writeFileSync(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/geo/(.*)$', headers: { 'cache-control': 'public, max-age=86400' }, continue: true },
    { src: '^/(.*)$', headers: { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' }, continue: true },
    { src: '^/api(?:/.*)?$', dest: '/api' },
    { handle: 'filesystem' },
    { src: '^/(.*)$', dest: '/index.html' },
  ],
}, null, 2));

console.log('[build-vercel] .vercel/output ready');
