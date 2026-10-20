import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kysely, MssqlDialect } from 'kysely';
import * as Tarn from 'tarn';
import * as Tedious from 'tedious';
import type { Database } from './schema.ts';

export type Db = Kysely<Database>;

/** Repository root, only meaningful when running from source (local development, CLI). */
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * Loads environment variables from a file of the repository: `.env` by default (local development), or the
 * file given by `--env <file>` on the command line, e.g. `npm run db:seed -- --env .env.tuke` for the TUKE
 * database. Only that one file is read, so a run against TUKE never picks up the local settings.
 * Under IIS (iisnode) nothing is loaded here: server.ts reads App_Data/.env of the API site.
 */
export function loadEnv(argv = process.argv): string | null {
  if (process.env.IISNODE_VERSION) return null;
  const flag = argv.indexOf('--env');
  const name = flag >= 0 ? argv[flag + 1] : '.env';
  if (!name) throw new Error('--env needs a file name, e.g. --env .env.tuke');
  const file = isAbsolute(name) ? name : join(REPO_ROOT, name);
  if (!existsSync(file)) {
    if (flag >= 0) throw new Error(`env file not found: ${file}`);
    return null;
  }
  applyEnvFile(file);
  return name;
}

/**
 * Puts the KEY=value lines of an env file into process.env without overriding variables already set: # comments,
 * optional "export ", values in single or double quotes, " #" starts a comment in an unquoted value. The rules of
 * process.loadEnvFile, which the Node.js 18 of the TUKE server does not have yet.
 */
export function applyEnvFile(file: string): void {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m as unknown as [string, string, string];
    const quoted = raw.length > 1 && (raw[0] === '"' || raw[0] === "'") && raw.endsWith(raw[0]);
    const value = quoted ? raw.slice(1, -1) : raw.replace(/\s+#.*$/, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export interface DbConfig {
  /** host name, or host\instance for a named instance (e.g. localhost\SQLEXPRESS, resolved by SQL Server Browser) */
  server: string;
  port: number;
  database: string;
  user: string;
  password: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
}

const flag = (value: string | undefined, fallback: boolean) => (value === undefined || value === '' ? fallback : /^(1|true|yes)$/i.test(value));

/**
 * Connection settings from the environment (SQL Server authentication):
 *   MSSQL_SERVER, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD
 *   MSSQL_PORT (1433), MSSQL_ENCRYPT (true), MSSQL_TRUST_SERVER_CERTIFICATE (false)
 */
export function dbConfig(env = process.env): DbConfig | null {
  if (!env.MSSQL_SERVER) return null;
  const missing = ['MSSQL_DATABASE', 'MSSQL_USER', 'MSSQL_PASSWORD'].filter(k => !env[k]);
  if (missing.length) throw new Error(`MSSQL_SERVER is set but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing`);
  return {
    server: env.MSSQL_SERVER,
    port: Number(env.MSSQL_PORT) || 1433,
    database: env.MSSQL_DATABASE!,
    user: env.MSSQL_USER!,
    password: env.MSSQL_PASSWORD!,
    encrypt: flag(env.MSSQL_ENCRYPT, true),
    trustServerCertificate: flag(env.MSSQL_TRUST_SERVER_CERTIFICATE, false),
  };
}

export function isDatabaseConfigured(env = process.env): boolean {
  return Boolean(env.MSSQL_SERVER);
}

/** "server/database" for logs; never includes the password. */
export function describeDatabase(env = process.env): string {
  const c = dbConfig(env);
  return c ? `${c.server}${c.server.includes('\\') ? '' : `:${c.port}`}/${c.database}` : 'no database';
}

function createKysely(c: DbConfig): Kysely<Database> {
  const [host, instanceName] = c.server.split('\\');
  const dialect = new MssqlDialect({
    tarn: { ...Tarn, options: { min: 0, max: 10, idleTimeoutMillis: 60_000, acquireTimeoutMillis: 20_000 } },
    tedious: {
      ...Tedious,
      connectionFactory: () => new Tedious.Connection({
        server: host!,
        authentication: { type: 'default', options: { userName: c.user, password: c.password } },
        options: {
          database: c.database,
          ...(instanceName ? { instanceName } : { port: c.port }),
          encrypt: c.encrypt,
          trustServerCertificate: c.trustServerCertificate,
          connectTimeout: 15_000,
          requestTimeout: 30_000,
          appName: 'ples-tuke',
        },
      }),
    },
  });
  return new Kysely<Database>({ dialect });
}

let base: Kysely<Database> | undefined;
let db: Db | undefined;

/**
 * Shared lazily created connection pool. Every table lives in schema dbo; the TUKE login has a default
 * schema of its own, so all names are qualified (withSchema).
 */
export async function getDb(): Promise<Db> {
  if (db) return db;
  const config = dbConfig();
  if (!config) throw new Error('The database is not configured: set MSSQL_SERVER, MSSQL_DATABASE, MSSQL_USER and MSSQL_PASSWORD');
  base = createKysely(config);
  db = base.withSchema('dbo');
  return db;
}

export async function closeDb(): Promise<void> {
  const b = base;
  base = undefined;
  db = undefined;
  await b?.destroy();
}
