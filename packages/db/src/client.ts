import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.ts';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Driver = 'neon' | 'pg' | 'pglite';

/** Repository root, only meaningful when running from source (local development, CLI). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Reads the repository .env when running locally; on Vercel the variables come from the project settings. */
export function loadEnv(): void {
  const file = `${REPO_ROOT}.env`;
  if (!process.env.VERCEL && existsSync(file)) process.loadEnvFile(file);
}

/**
 * Which driver to use:
 *  - DATABASE_URL on *.neon.tech -> Neon HTTP driver (serverless, no connection pool to manage)
 *  - any other DATABASE_URL       -> node-postgres (e.g. a Postgres server at TUKE after moving off Vercel)
 *  - no DATABASE_URL              -> PGlite, an embedded Postgres in .data/pglite (local development only)
 */
export function resolveDriver(env = process.env): Driver {
  if (env.DB_DRIVER === 'neon' || env.DB_DRIVER === 'pg' || env.DB_DRIVER === 'pglite') return env.DB_DRIVER;
  if (!env.DATABASE_URL) return 'pglite';
  return /\.neon\.tech\b/.test(env.DATABASE_URL) ? 'neon' : 'pg';
}

export function isDatabaseConfigured(env = process.env): boolean {
  return Boolean(env.DATABASE_URL) || !env.VERCEL;
}

interface Connection { db: Db; driver: Driver; close: () => Promise<void> }
let connection: Promise<Connection> | undefined;

async function connect(): Promise<Connection> {
  const driver = resolveDriver();
  const url = process.env.DATABASE_URL;
  if (driver === 'neon') {
    const { neon } = await import('@neondatabase/serverless');
    const { drizzle } = await import('drizzle-orm/neon-http');
    return { driver, db: drizzle({ client: neon(url!), schema }) as unknown as Db, close: async () => {} };
  }
  if (driver === 'pg') {
    const { default: pg } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    return { driver, db: drizzle({ client: pool, schema }) as unknown as Db, close: () => pool.end() };
  }
  if (process.env.VERCEL) throw new Error('DATABASE_URL is not set: connect a Postgres database (Neon) to the Vercel project');
  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { drizzle } = await import('drizzle-orm/pglite');
  const dir = process.env.PGLITE_DIR ?? `${REPO_ROOT}.data/pglite`;
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir, { extensions: { pg_trgm } });
  return { driver, db: drizzle({ client, schema }) as unknown as Db, close: () => client.close() };
}

/** Shared lazily created connection. */
export function getDb(): Promise<Db> {
  connection ??= connect().catch(err => { connection = undefined; throw err; });
  return connection.then(c => c.db);
}

export async function getDriver(): Promise<Driver> {
  return resolveDriver();
}

export async function closeDb(): Promise<void> {
  if (!connection) return;
  const c = await connection;
  connection = undefined;
  await c.close();
}

/** Applies the SQL migrations from packages/db/drizzle with the migrator of the active driver. */
export async function runMigrations(): Promise<Driver> {
  const db = await getDb();
  const driver = resolveDriver();
  const config = { migrationsFolder: MIGRATIONS_DIR };
  if (driver === 'neon') {
    const { migrate } = await import('drizzle-orm/neon-http/migrator');
    await migrate(db as never, config);
  } else if (driver === 'pg') {
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    await migrate(db as never, config);
  } else {
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    await migrate(db as never, config);
  }
  return driver;
}
