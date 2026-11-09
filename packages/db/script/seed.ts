import { createStore, getStore, dataMode } from '../src/connection';
import { fixtureArchive } from '../src/fixtures';
import { assertSeedAllowed, seedArchive } from '../src/seed';
import { migrationDatabaseUrl } from './environment';

assertSeedAllowed(process.env, process.argv.slice(2));
const store =
  dataMode() === 'database'
    ? await createStore({ mode: 'database', url: migrationDatabaseUrl() })
    : await getStore();
try {
  const attempted = await store.transaction((transaction) =>
    seedArchive(transaction, fixtureArchive),
  );
  console.log(`Seed complete: ${attempted} insert attempts; existing records were preserved.`);
} finally {
  await store.close();
}
