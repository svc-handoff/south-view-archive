import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createStore } from '../src/connection';

// Restores archive.persons.data from a backup written by the 2026-10-31 profile rollout
// (.southview/backups/archive-before-profiles-*.json). That rollout rewrote the person rows into
// a profile shape this archive cannot read; the backup holds the rows as they were just before.
// Only the person rows named in the backup change. Without --apply the script only reports the
// current shape of each row. Nothing from the environment file is printed.
//
//   pnpm db:restore-persons --backup .southview/backups/archive-before-profiles-1793477519223.json \
//     --env apps/nextjs/.env.local.production-backup --apply
//
// --env loads a dotenv file and takes the session connection from POSTGRES_URL_NON_POOLING
// (or MIGRATION_DATABASE_URL). Without --env, MIGRATION_DATABASE_URL must already be set.
const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const backupPath = option('--backup');
if (!backupPath) {
  console.error('Usage: restore-persons --backup <file> [--env <dotenv file>] [--apply]');
  process.exit(1);
}
// pnpm runs this inside packages/db; paths are relative to where the command was typed.
const base = process.env.INIT_CWD ?? process.cwd();
const envPath = option('--env');
if (envPath) loadEnvFile(resolve(base, envPath));
const url = process.env.MIGRATION_DATABASE_URL || process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error('Set MIGRATION_DATABASE_URL, or pass --env with a file that defines it.');
  process.exit(1);
}
const apply = args.includes('--apply');
const backup = JSON.parse(readFileSync(resolve(base, backupPath), 'utf8')) as {
  createdAt: string;
  archive: { persons: { id: string; data: Record<string, unknown> }[] };
};

const store = await createStore({ mode: 'database', url, migrate: false, seed: false });
try {
  const current = await store.query<{ id: string; data: Record<string, unknown> }>(
    'SELECT id, data FROM archive.persons ORDER BY id',
  );
  for (const row of current.rows) {
    const archiveShape = 'biography' in row.data && 'themes' in row.data;
    console.log(
      `${row.id}: ${archiveShape ? 'archive shape' : 'NOT archive shape'} (keys: ${Object.keys(row.data).sort().join(', ')})`,
    );
  }
  if (!apply) {
    console.log(
      `Dry run. Backup from ${backup.createdAt} holds ${backup.archive.persons.length} person rows; add --apply to restore them.`,
    );
  } else {
    const restored = await store.transaction(async (tx) => {
      let count = 0;
      for (const person of backup.archive.persons) {
        const result = await tx.query<{ id: string }>(
          'UPDATE archive.persons SET data = $2::jsonb WHERE id = $1 RETURNING id',
          [person.id, JSON.stringify(person.data)],
        );
        count += result.rows.length;
      }
      return count;
    });
    console.log(`Restored ${restored} person rows from the backup.`);
  }
} finally {
  await store.close();
}
