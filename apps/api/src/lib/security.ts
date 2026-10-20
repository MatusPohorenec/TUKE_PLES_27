import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { getDb, isDatabaseConfigured, sql } from '@ples/db';
import { fail } from './http.ts';

/** Under IIS (iisnode) the API always runs as the production deployment, whatever NODE_ENV says. */
const isProduction = () => process.env.NODE_ENV === 'production' || Boolean(process.env.IISNODE_VERSION);
const configuredSecret = () => (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16 ? process.env.SESSION_SECRET : undefined);
let storedSecret: string | undefined;

/**
 * Without SESSION_SECRET the server creates a random secret once and keeps it in app_settings,
 * so nobody has to generate or paste one. Called before every route that signs or hashes.
 */
export async function ensureSecret(): Promise<void> {
  if (configuredSecret() || storedSecret || !isDatabaseConfigured()) return;
  const db = await getDb();
  const key = 'session_secret';
  // insert unless present; the range lock makes two first requests at once agree on one secret
  await sql`
    insert into dbo.app_settings ([key], value)
    select ${key}, ${randomBytes(32).toString('base64url')}
    where not exists (select 1 from dbo.app_settings with (updlock, holdlock) where [key] = ${key})`.execute(db);
  const row = await db.selectFrom('app_settings').select('value').where('key', '=', key).executeTakeFirst();
  storedSecret = row?.value;
}

/** Secret for HMACs: SESSION_SECRET, else the one stored in the database, else a fixed value in local development. */
function secret(): string {
  const s = configuredSecret() ?? storedSecret;
  if (s) return s;
  if (isProduction()) fail(503, 'not_configured', 'Server nemá kľúč na podpisovanie (SESSION_SECRET ani databázu).');
  return 'local-development-secret';
}

export const hmac = (value: string) => createHmac('sha256', secret()).update(value).digest('base64url');
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a)), y = Buffer.from(sha256(b));
  return timingSafeEqual(x, y);
}

/**
 * Client address, or null when unknown (local development). iisnode (enableXFF in iisnode.yml) appends the
 * address IIS sees to X-Forwarded-For, so only the last entry is trusted; earlier entries come from the client.
 */
export function clientIp(c: Context): string | null {
  const last = c.req.header('x-forwarded-for')?.split(',').map(s => s.trim()).filter(Boolean).at(-1);
  return last || null;
}

/** IP + day: enough to slow down abuse, not enough to follow anyone across days. Unknown addresses share one value. */
export const ipHash = (c: Context) => hmac(`ip|${clientIp(c) ?? 'unknown'}|${new Date().toISOString().slice(0, 10)}`).slice(0, 32);

/** The random id a browser keeps in localStorage, never stored in clear text. */
export function deviceHash(c: Context): string {
  const id = c.req.header('x-device-id') ?? '';
  if (!/^[0-9a-f-]{16,64}$/i.test(id)) fail(400, 'device_missing', 'Chýba identifikátor zariadenia. Obnov stránku a skús znova.');
  return hmac(`device|${id.toLowerCase()}`).slice(0, 32);
}

// ---------------------------------------------------------------- admin session

const COOKIE = 'ples_admin';
const SESSION_HOURS = 12;

export function adminPasswordConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

export function checkAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  return Boolean(expected) && safeEqual(password, expected!);
}

/**
 * Host-only cookie of the API host. SameSite=Strict still works when the web runs on another host of the
 * same site (srdcom.tuke.sk -> api.srdcom.tuke.sk): SameSite compares sites (tuke.sk), not origins.
 */
export function startSession(c: Context): void {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  setCookie(c, COOKIE, `${exp}.${hmac(`admin|${exp}`)}`, {
    httpOnly: true, secure: isProduction(), sameSite: 'Strict', path: '/api/admin', maxAge: SESSION_HOURS * 3600,
  });
}

export function endSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: '/api/admin', secure: isProduction(), sameSite: 'Strict' });
}

export function hasSession(c: Context): boolean {
  const value = getCookie(c, COOKIE);
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, hmac(`admin|${exp}`));
}
