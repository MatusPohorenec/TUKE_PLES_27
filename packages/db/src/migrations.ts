/**
 * Plain SQL migrations: packages/db/migrations/NNNN_name.sql, applied in file name order, each one in its own
 * transaction (SQL Server DDL is transactional). Batches inside a file are separated by lines with just GO,
 * like in SSMS. Applied files are recorded in dbo.schema_migrations; never edit an applied file, add a new one.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'kysely';
import type { Db } from './client.ts';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

export const splitBatches = (script: string) => script.split(/^\s*GO\s*$/im).map(s => s.trim()).filter(Boolean);

/** Applies the pending migrations, returns the names of the files applied now. */
export async function runMigrations(db: Db): Promise<string[]> {
  await sql`
    if object_id(N'dbo.schema_migrations', N'U') is null
      create table dbo.schema_migrations (
        id nvarchar(200) not null constraint schema_migrations_pkey primary key,
        applied_at datetime2(3) not null constraint schema_migrations_applied_at_df default sysutcdatetime()
      )`.execute(db);
  const files = readdirSync(MIGRATIONS_DIR).filter(f => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const file of files) {
    const done = await db.transaction().execute(async trx => {
      // one migrator at a time; the lock is released with the transaction
      await sql`
        declare @lock int;
        exec @lock = sp_getapplock @Resource = N'ples_migrations', @LockMode = N'Exclusive', @LockOwner = N'Transaction', @LockTimeout = 60000;
        if @lock < 0 throw 50000, N'another migration is running', 1;`.execute(trx);
      const seen = await trx.selectFrom('schema_migrations').select('id').where('id', '=', file).executeTakeFirst();
      if (seen) return false;
      for (const batch of splitBatches(readFileSync(`${MIGRATIONS_DIR}/${file}`, 'utf8'))) await sql.raw(batch).execute(trx);
      await trx.insertInto('schema_migrations').values({ id: file }).execute();
      return true;
    });
    if (done) applied.push(file);
  }
  return applied;
}
