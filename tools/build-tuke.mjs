// npm run build:tuke [-- --api-url https://api.srdcom.tuke.sk/api]
// Builds the deployment for the TUKE Plesk server (Windows, IIS + iisnode) into deploy/. Plesk manages web.config
// at TUKE and a deploy never changes it, so nothing here relies on one:
//   deploy/web/  -> srdcom.tuke.sk      the static web app; every page route also gets a folder with a copy of
//                                       index.html (/mapa -> mapa/index.html), so IIS serves it without a rewrite,
//                                       also under each venue prefix (/vestibul, /vestibul/mapa …)
//   deploy/api/  -> api.srdcom.tuke.sk  app.js (iisnode startup file) + api.mjs (the whole API in one ES module,
//                                       no node_modules on the server) + the dataset snapshot + iisnode.yml
//                                       (iisnode settings) + App_Data/ (source map, .env.example; never served)
//   deploy/srdcom-web.zip, deploy/srdcom-api.zip  the same folders zipped for Plesk File Manager (Upload, Extract)
// The web calls the API at --api-url, else VITE_API_URL, else https://api.srdcom.tuke.sk/app.js/api: the Plesk
// web.config has no rewrite to app.js, but IIS hands /app.js/<path> to iisnode and server.ts drops the prefix.
// The API bundle targets Node.js 18, the version Plesk runs at TUKE.
// The settings with passwords (App_Data/.env) are never part of the build: they are created once on the server.
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { cpSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'deploy');
const arg = name => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const apiUrl = (arg('--api-url') ?? process.env.VITE_API_URL ?? 'https://api.srdcom.tuke.sk/app.js/api').replace(/\/+$/, '');
const git = cmd => execSync(`git ${cmd}`, { cwd: root, encoding: 'utf8' }).trim();
const commit = git('rev-parse --short=7 HEAD') + (git('status --porcelain') ? '-dirty' : '');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'api'), { recursive: true });

// ------------------------------------------------------------ web
execSync('npm run build -w @ples/web', { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_API_URL: apiUrl } });
cpSync(join(root, 'apps/web/dist'), join(out, 'web'), { recursive: true });
// the page routes of apps/web/src/main.tsx (ROUTES); the app ignores the trailing slash IIS adds for a folder
const routes = [...readFileSync(join(root, 'apps/web/src/main.tsx'), 'utf8').matchAll(/^\s*'\/([a-z0-9-]+)':/gm)].map(m => m[1]);
if (!routes.includes('mapa') || !routes.includes('zapoj-sa')) throw new Error(`page routes not found in main.tsx: ${routes.join(', ')}`);
// the venues with a path prefix (VENUES in packages/shared): the student lobby has every page under /vestibul
const venues = [...readFileSync(join(root, 'packages/shared/src/constants.ts'), 'utf8').matchAll(/\bprefix: '\/([a-z0-9-]+)'/g)].map(m => m[1]);
if (!venues.includes('vestibul')) throw new Error(`venue prefixes not found in packages/shared/src/constants.ts: ${venues.join(', ')}`);
const pageFolders = [...routes, ...venues.flatMap(venue => [venue, ...routes.map(route => `${venue}/${route}`)])];
for (const folder of pageFolders) {
  mkdirSync(join(out, 'web', folder), { recursive: true });
  cpSync(join(out, 'web/index.html'), join(out, 'web', folder, 'index.html'));
}

// ------------------------------------------------------------ api
await build({
  entryPoints: [join(root, 'apps/api/src/server.ts')],
  outfile: join(out, 'api/api.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'esm',
  sourcemap: 'linked',
  define: { 'process.env.APP_COMMIT': JSON.stringify(commit) },
  // tedious and its dependencies are CommonJS and call require() for Node built-ins
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
// the server has no node_modules: any import of a package left in the bundle would crash at start
const bundle = readFileSync(join(out, 'api/api.mjs'), 'utf8');
const imports = [...bundle.matchAll(/^import\s[^;]*?from\s*["']([^"']+)["']/gm), ...bundle.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)]
  .map(m => m[1]).filter(s => !s.startsWith('node:') && !s.startsWith('.') && !builtinModules.includes(s));
if (imports.length) throw new Error(`API bundle imports packages that are not bundled: ${[...new Set(imports)].join(', ')}`);
// the source map (readable stack traces in the logs) goes to App_Data, which IIS never serves
mkdirSync(join(out, 'api/App_Data'), { recursive: true });
renameSync(join(out, 'api/api.mjs.map'), join(out, 'api/App_Data/api.mjs.map'));
writeFileSync(join(out, 'api/api.mjs'), bundle.replace(/\/\/# sourceMappingURL=api\.mjs\.map\s*$/, '//# sourceMappingURL=App_Data/api.mjs.map\n'));

writeFileSync(join(out, 'api/app.js'), `// iisnode startup file. iisnode loads it with require(), the API is an ES module: start it with import().
process.setSourceMapsEnabled(true);
import('./api.mjs').catch(err => { console.error('[api] failed to start', err); process.exit(1); });
`);
writeFileSync(join(out, 'api/package.json'), `${JSON.stringify({ private: true, type: 'commonjs', description: `TUKE ball API ${commit}` }, null, 2)}\n`);
cpSync(join(root, 'data/tuke_cooperation.json'), join(out, 'api/tuke_cooperation.json'));
cpSync(join(root, 'tools/iis/iisnode.yml'), join(out, 'api/iisnode.yml'));
cpSync(join(root, 'tools/iis/env.example'), join(out, 'api/App_Data/.env.example'));

const info = `commit ${commit}\nbuilt ${new Date().toISOString()}\napi ${apiUrl}\n`;
writeFileSync(join(out, 'web/build.txt'), info);
writeFileSync(join(out, 'api/build.txt'), info);

// ------------------------------------------------------------ zip archives
/**
 * Minimal zip writer (deflate), enough for Plesk File Manager's "Extract Files". Entries carry the build time:
 * IIS derives the ETag of a file from its time, and index.html must not look unchanged after a deploy.
 */
const now = new Date();
const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) >>> 0;
const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) >>> 0;
const dosStamp = ((dosDate << 16) | dosTime) >>> 0;
function zipDir(dir, file) {
  const files = [];
  const walk = d => readdirSync(d).forEach(n => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p); });
  walk(dir);
  const local = [], central = [];
  let offset = 0;
  for (const path of files) {
    const name = Buffer.from(relative(dir, path).split('\\').join('/'));
    const data = readFileSync(path);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt32LE(dosStamp, 10);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    local.push(head, name, packed);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10); entry.writeUInt32LE(dosStamp, 12); entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += head.length + name.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  writeFileSync(file, Buffer.concat([...local, cd, end]));
  return files.length;
}
const webFiles = zipDir(join(out, 'web'), join(out, 'srdcom-web.zip'));
const apiFiles = zipDir(join(out, 'api'), join(out, 'srdcom-api.zip'));

console.log(`[build-tuke] ${commit}: deploy/web (${webFiles} files) -> srdcom.tuke.sk, deploy/api (${apiFiles} files) -> api.srdcom.tuke.sk
[build-tuke] the web calls ${apiUrl}`);
