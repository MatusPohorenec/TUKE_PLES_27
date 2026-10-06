import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { appSettings, getDb, isDatabaseConfigured } from '@ples/db';
import { fail } from './http.ts';

const isProduction = () => Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
const configuredSecret = () => (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16 ? process.env.SESSION_SECRET : undefined);
let storedSecret: string | undefined;

/**
 * Without SESSION_SECRET the server creates a random secret once and keeps it in app_settings,
 * so nobody has to generate or paste one. Called before every route that signs or hashes.
 */
export async function ensureSecret(): Promise<void> {
  if (configuredSecret() || storedSecret || !isDatabaseConfigured()) return;
  const db = await getDb();
  await db.insert(appSettings).values({ key: 'session_secret', value: randomBytes(32).toString('base64url') }).onConflictDoNothing();
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, 'session_secret'));
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

/** Client address as set by the Vercel edge (x-real-ip) or a local proxy. */
export function clientIp(c: Context): string {
  return c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}

/** IP + day: enough to slow down abuse, not enough to follow anyone across days. */
export const ipHash = (c: Context) => hmac(`ip|${clientIp(c)}|${new Date().toISOString().slice(0, 10)}`).slice(0, 32);

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

export function startSession(c: Context): void {
  const exp = Date.now() + SESSION_HOURS * 3600_000;
  setCookie(c, COOKIE, `${exp}.${hmac(`admin|${exp}`)}`, {
    httpOnly: true, secure: isProduction(), sameSite: 'Strict', path: '/api/admin', maxAge: SESSION_HOURS * 3600,
  });
}

export function endSession(c: Context): void {
  deleteCookie(c, COOKIE, { path: '/api/admin' });
}

export function hasSession(c: Context): boolean {
  const value = getCookie(c, COOKIE);
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return safeEqual(sig, hmac(`admin|${exp}`));
}
