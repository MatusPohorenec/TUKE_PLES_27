import { defineConfig } from 'drizzle-kit';

// Only `drizzle-kit generate` is used: it diffs src/schema.ts against drizzle/ and writes SQL.
// Migrations are applied by src/cli/migrate.ts so the same code path runs on Neon, Postgres and PGlite.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
});
