import { validateArchive, type ArchiveData } from '@southview/validators';
import { closeStores, createStore, getStore, type Store } from './connection';

/** Reads only explicitly public tables. Never join private submissions/authentication here. */
export async function readStoreArchive(store: Store): Promise<ArchiveData> {
  return store.transaction(async (tx) => {
    if (store.dialect === 'database')
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const read = async (table: string) =>
      (await tx.query<{ data: unknown }>(`SELECT data FROM archive.${table} ORDER BY id`)).rows.map(
        (row) => row.data,
      );
    const people = await read('persons');
    const places = await read('places');
    const relations = await read('person_places');
    const materials = await read('materials');
    const sources = await read('sources');
    // Issue rows carry their identifier only in the row, so staff can address one note.
    const issues = (
      await tx.query<{ id: string; data: Record<string, unknown> }>(
        'SELECT id, data FROM archive.issues ORDER BY id',
      )
    ).rows.map((row) => ({ ...row.data, id: row.id }));
    const credits = await read('credits');
    const contributions = await read('contributions');
    const crosswalk = (
      await tx.query<{ data: unknown }>(
        'SELECT data FROM archive.crosswalk ORDER BY project, external_id',
      )
    ).rows.map((row) => row.data);
    return validateArchive({
      people,
      places,
      relations,
      materials,
      sources,
      issues,
      crosswalk,
      credits,
      contributions,
    });
  });
}
export async function readDatabaseArchive(url: string): Promise<ArchiveData> {
  const store = await createStore({ mode: 'database', url });
  try {
    return await readStoreArchive(store);
  } finally {
    await store.close();
  }
}
export async function readCurrentArchive() {
  return readStoreArchive(await getStore());
}
export const closeDatabaseConnections = closeStores;
