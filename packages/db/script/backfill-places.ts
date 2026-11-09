import { createStore, getStore, dataMode } from '../src/connection';
import { fixtureArchive } from '../src/fixtures';
import { migrationDatabaseUrl } from './environment';

// Fills in the fixture description for seeded places that still have none, and drops the old
// "· South-View" suffix from seeded grave names that still carry it. Places a reviewer has already
// described or renamed are left alone, so the script is safe to run again. Stop a local
// development server first: PGlite allows one process at a time.
const formerNames: Record<string, string> = {
  'lewis-south-view': 'John Lewis · South-View',
  'king-sr-south-view': 'King family crypt · South-View',
  'herndon-south-view': 'Alonzo Herndon · South-View',
};
const store =
  dataMode() === 'database'
    ? await createStore({ mode: 'database', url: migrationDatabaseUrl() })
    : await getStore();
try {
  const updated = await store.transaction(async (tx) => {
    let count = 0;
    for (const place of fixtureArchive.places) {
      const row = (
        await tx.query<{ data: Record<string, unknown> }>(
          'SELECT data FROM archive.places WHERE id = $1 FOR NO KEY UPDATE',
          [place.id],
        )
      ).rows[0];
      if (!row) continue;
      const next = { ...row.data };
      const described = typeof row.data.summary === 'string' && row.data.summary.trim();
      if (place.summary && !described) {
        next.summary = place.summary;
        next.summaryCitations = place.summaryCitations;
      }
      if (formerNames[place.id] && row.data.name === formerNames[place.id]) {
        next.name = place.name;
      }
      if (JSON.stringify(next) === JSON.stringify(row.data)) continue;
      await tx.query('UPDATE archive.places SET data = $2::jsonb WHERE id = $1', [
        place.id,
        JSON.stringify(next),
      ]);
      count++;
    }
    return count;
  });
  console.log(`Places updated: ${updated}.`);
} finally {
  await store.close();
}
