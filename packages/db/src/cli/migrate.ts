/**
 * npm run db:migrate [-- --env .env.tuke]
 * Applies the SQL migrations in packages/db/migrations to the database configured by MSSQL_* (see .env.example).
 * Without --env the repository .env is used (local SQL Server); --env names another file, e.g. the TUKE database.
 */
import { closeDb, describeDatabase, getDb, isDatabaseConfigured, loadEnv } from '../client.ts';
import { runMigrations } from '../migrations.ts';

const envFile = loadEnv();
if (!isDatabaseConfigured()) {
  console.error('[db:migrate] MSSQL_SERVER is not set (copy .env.example to .env, or pass --env <file>)');
  process.exit(1);
}
console.log(`[db:migrate] ${describeDatabase()}${envFile ? ` (from ${envFile})` : ''}`);
try {
  const applied = await runMigrations(await getDb());
  console.log(applied.length ? `[db:migrate] applied: ${applied.join(', ')}` : '[db:migrate] up to date');
} finally {
  await closeDb();
}
