/**
 * npm run db:migrate
 * Runs on every Vercel build (see "vercel-build" in the root package.json). Without a database on Vercel
 * it only warns, so the first deployment works before Neon is connected (the globe then uses the bundled snapshot).
 */
import { closeDb, isDatabaseConfigured, loadEnv, runMigrations } from '../client.ts';

loadEnv();
if (!isDatabaseConfigured()) {
  console.warn('[db:migrate] DATABASE_URL is not set, skipping migrations');
  process.exit(0);
}
const driver = await runMigrations();
console.log(`[db:migrate] migrations applied (${driver})`);
await closeDb();
