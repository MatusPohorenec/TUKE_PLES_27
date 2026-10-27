import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Kysely, MssqlDialect } from 'kysely';
import * as Tarn from 'tarn';
import * as Tedious from 'tedious';
import { VENUES, VENUE_KEYS, type VenueKey } from '@ples/shared/constants';
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

/** Environment names of a venue's database: MSSQL_* for the ball, MSSQL_VESTIBUL_* for the student lobby. */
const ENV_PREFIX: Record<VenueKey, string> = { ples: 'MSSQL_', vestibul: 'MSSQL_VESTIBUL_' };

/** The variable that switches a venue's database on: the server for the ball, the database for the lobby. */
export const dbSwitch = (venue: VenueKey) => (venue === 'ples' ? 'MSSQL_SERVER' : `${ENV_PREFIX[venue]}DATABASE`);

/**
 * Connection settings of a venue's database from the environment (SQL Server authentication).
 * The ball: MSSQL_SERVER, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD, MSSQL_PORT (1433), MSSQL_ENCRYPT (true),
 * MSSQL_TRUST_SERVER_CERTIFICATE (false).
 * The student lobby: the same names with MSSQL_VESTIBUL_. Only MSSQL_VESTIBUL_DATABASE is required: the server,
 * port and TLS settings default to the ball's, the login too (MSSQL_VESTIBUL_USER needs its own
 * MSSQL_VESTIBUL_PASSWORD). The database must be another one than the ball's: the venues never share data.
 */
export function dbConfig(venue: VenueKey = 'ples', env = process.env): DbConfig | null {
  const prefix = ENV_PREFIX[venue];
  const own = (name: string) => env[prefix + name] || undefined;
  const inherited = (name: string) => own(name) ?? (venue === 'ples' ? undefined : env[`MSSQL_${name}`] || undefined);
  if (!env[dbSwitch(venue)]) return null;
  const server = inherited('SERVER');
  const database = own('DATABASE');
  const user = inherited('USER');
  const password = own('USER') ? own('PASSWORD') : inherited('PASSWORD');
  const missing = Object.entries({ SERVER: server, DATABASE: database, USER: user, PASSWORD: password }).filter(([, v]) => !v).map(([k]) => prefix + k);
  if (missing.length) throw new Error(`${dbSwitch(venue)} is set but ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing`);
  const config: DbConfig = {
    server: server!,
    port: Number(inherited('PORT')) || 1433,
    database: database!,
    user: user!,
    password: password!,
    encrypt: flag(inherited('ENCRYPT'), true),
    trustServerCertificate: flag(inherited('TRUST_SERVER_CERTIFICATE'), false),
  };
  if (venue !== 'ples') {
    const ball = dbConfig('ples', env);
    if (ball && ball.server.toLowerCase() === config.server.toLowerCase() && ball.database.toLowerCase() === config.database.toLowerCase()) {
      throw new Error(`${prefix}DATABASE names the database of the ball (MSSQL_DATABASE): ${VENUES[venue].name} needs a database of its own`);
    }
  }
  return config;
}

export function isDatabaseConfigured(venue: VenueKey = 'ples', env = process.env): boolean {
  return Boolean(env[dbSwitch(venue)]);
}

/** "server/database" for logs; never includes the password. */
export function describeDatabase(venue: VenueKey = 'ples', env = process.env): string {
  const c = dbConfig(venue, env);
  return c ? `${c.server}${c.server.includes('\\') ? '' : `:${c.port}`}/${c.database}` : 'no database';
}

/** The venue a command line names with --venue <key> (default: the ball), e.g. npm run db:seed -- --venue vestibul. */
export function venueArg(argv = process.argv): VenueKey {
  const flagAt = argv.indexOf('--venue');
  if (flagAt < 0) return 'ples';
  const key = argv[flagAt + 1];
  if (!key || !(VENUE_KEYS as string[]).includes(key)) throw new Error(`--venue needs one of: ${VENUE_KEYS.join(', ')}`);
  return key as VenueKey;
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

const pools = new Map<VenueKey, { base: Kysely<Database>; db: Db }>();

/**
 * Lazily created connection pool of a venue's database (one per venue, shared by all requests). Every table
 * lives in schema dbo; the TUKE login has a default schema of its own, so all names are qualified (withSchema).
 */
export async function getDb(venue: VenueKey = 'ples'): Promise<Db> {
  const pool = pools.get(venue);
  if (pool) return pool.db;
  const config = dbConfig(venue);
  if (!config) throw new Error(`The database of ${VENUES[venue].name} is not configured: set ${dbSwitch(venue)} (see .env.example)`);
  const base = createKysely(config);
  const db = base.withSchema('dbo');
  pools.set(venue, { base, db });
  return db;
}

export async function closeDb(): Promise<void> {
  const open = [...pools.values()];
  pools.clear();
  await Promise.all(open.map(p => p.base.destroy()));
}
