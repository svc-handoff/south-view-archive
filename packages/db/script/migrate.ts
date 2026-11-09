import { createStore, getStore, dataMode, migrateStore } from '../src/connection';
import { migrationDatabaseUrl } from './environment';

// Local mode uses the same durable workspace store as Next. Database mode always
// requires the explicit migration connection (never the application's pooled URL).
const store =
  dataMode() === 'database'
    ? await createStore({ mode: 'database', url: migrationDatabaseUrl() })
    : await getStore();
try {
  await migrateStore(store);
  console.log('All archive migrations are applied.');
} finally {
  await store.close();
}
