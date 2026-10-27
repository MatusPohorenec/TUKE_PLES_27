/**
 * npm run db:migrate [-- --env .env.tuke] [--venue vestibul]
 * Applies the SQL migrations in packages/db/migrations to a venue's database (see .env.example): the ball's
 * (MSSQL_*) by default, the student lobby's (MSSQL_VESTIBUL_*) with --venue vestibul.
 * Without --env the repository .env is used (local SQL Server); --env names another file, e.g. the TUKE database.
 */
import { VENUES } from '@ples/shared/constants';
import { closeDb, dbSwitch, describeDatabase, getDb, isDatabaseConfigured, loadEnv, venueArg } from '../client.ts';
import { runMigrations } from '../migrations.ts';

const envFile = loadEnv();
const venue = venueArg();
if (!isDatabaseConfigured(venue)) {
  console.error(`[db:migrate] ${dbSwitch(venue)} is not set (copy .env.example to .env, or pass --env <file>)`);
  process.exit(1);
}
console.log(`[db:migrate] ${VENUES[venue].name}: ${describeDatabase(venue)}${envFile ? ` (from ${envFile})` : ''}`);
try {
  const applied = await runMigrations(await getDb(venue));
  console.log(applied.length ? `[db:migrate] applied: ${applied.join(', ')}` : '[db:migrate] up to date');
} finally {
  await closeDb();
}
