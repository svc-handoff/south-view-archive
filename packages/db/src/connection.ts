import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { drizzle as postgresDrizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { fixtureArchive } from './fixtures';
import { seedArchive } from './seed';

export type Store = {
  query<T = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (store: Store) => Promise<T>): Promise<T>;
  orm: ReturnType<typeof pgliteDrizzle> | ReturnType<typeof postgresDrizzle>;
  dialect: 'local' | 'database';
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
};

export function projectRoot() {
  // Local persistence is runtime state. It must never be copied into deployment bundles.
  let directory = resolve(/* turbopackIgnore: true */ process.cwd());
  while (!existsSync(join(directory, 'packages', 'db', 'package.json'))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Could not locate the archive workspace.');
    directory = parent;
  }
  return directory;
}

/** Never includes credentials in messages intended to reach a route handler. */
export function dataMode(environment = process.env): 'fixture' | 'local' | 'database' {
  const mode = environment.ARCHIVE_DATA_MODE ?? 'local';
  if (mode !== 'fixture' && mode !== 'local' && mode !== 'database')
    throw new Error('ARCHIVE_DATA_MODE must be fixture, local, or database.');
  return mode;
}

export async function migrateStore(store: Store) {
  const directory = join(projectRoot(), 'packages', 'db', 'migrations');
  const versions = (await readdir(directory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  await store.transaction(async (tx) => {
    if (store.dialect === 'database') await tx.query('SELECT pg_advisory_xact_lock(731864219)');
    await tx.exec(
      'CREATE SCHEMA IF NOT EXISTS archive; CREATE TABLE IF NOT EXISTS archive.schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());',
    );
    for (const version of versions) {
      const content = await readFile(join(directory, version), 'utf8');
      const checksum = createHash('sha256').update(content).digest('hex');
      const result = await tx.query<{ checksum: string }>(
        'SELECT checksum FROM archive.schema_migrations WHERE version = $1',
        [version],
      );
      if (result.rows.length) {
        if (result.rows[0]!.checksum !== checksum)
          throw new Error(`Previously applied migration changed: ${version}`);
        continue;
      }
      await tx.exec(content);
      await tx.query('INSERT INTO archive.schema_migrations (version, checksum) VALUES ($1, $2)', [
        version,
        checksum,
      ]);
    }
  });
}

export type StoreOptions =
  | { mode: 'local'; path?: string; migrate?: boolean; seed?: boolean }
  | { mode: 'database'; url: string; migrate?: boolean; seed?: false };

async function lockLocalDirectory(path: string): Promise<() => Promise<void>> {
  if (path.startsWith('memory://')) return async () => {};
  const lockPath = `${resolve(path)}.process-lock`;
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(owner);
      } finally {
        await handle.close();
      }
      return async () => {
        try {
          if ((await readFile(lockPath, 'utf8')) === owner) await unlink(lockPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Serialize stale-lock recovery too: comparing a file and then unlinking it
      // without this mutex can delete a new owner's lock when two processes start.
      const recoveryPath = `${lockPath}.recovery`;
      try {
        await mkdir(recoveryPath);
      } catch {
        throw new Error(
          'Another process is checking the local archive lock. Retry after it finishes.',
        );
      }
      try {
        let previous: string;
        try {
          previous = await readFile(lockPath, 'utf8');
        } catch (readError) {
          if ((readError as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw readError;
        }
        let active = true;
        try {
          const { pid } = JSON.parse(previous) as { pid: number };
          if (Number.isSafeInteger(pid) && pid > 0) {
            try {
              process.kill(pid, 0);
            } catch (signalError) {
              if ((signalError as NodeJS.ErrnoException).code === 'ESRCH') active = false;
            }
          }
        } catch {
          /* Incomplete locks fail closed instead of risking live data. */
        }
        if (active)
          throw new Error(
            'The local archive is open in another process. Stop the development server before running a database or reviewer command, then restart it.',
          );
        if ((await readFile(lockPath, 'utf8')) === previous) await unlink(lockPath);
      } finally {
        await rmdir(recoveryPath);
      }
    }
  }
  throw new Error('Could not exclusively open the local archive.');
}

/** Independent stores are for scripts/tests. Request code must use getStore(). */
export async function createStore(options: StoreOptions): Promise<Store> {
  let store: Store;
  if (options.mode === 'local') {
    const path = options.path ?? join(projectRoot(), '.southview', 'db');
    if (!path.startsWith('memory://')) await mkdir(path, { recursive: true });
    const unlock = await lockLocalDirectory(path);
    let client: PGlite;
    try {
      client = new PGlite(path);
      await client.waitReady;
    } catch (error) {
      await unlock();
      throw error;
    }
    let closed = false;
    const wrap = (connection: Pick<PGlite, 'query' | 'exec' | 'transaction'>): Store => ({
      query: async <T>(sql: string, values: unknown[] = []) => ({
        rows: (await connection.query<T>(sql, values)).rows,
      }),
      exec: async (sql) => {
        await connection.exec(sql);
      },
      transaction: (fn) =>
        connection.transaction((tx) =>
          fn(wrap(tx as unknown as Pick<PGlite, 'query' | 'exec' | 'transaction'>)),
        ),
      orm: pgliteDrizzle(client),
      dialect: 'local',
      close: async () => {
        if (closed) return;
        closed = true;
        try {
          await client.close();
        } finally {
          await unlock();
        }
      },
    });
    store = wrap(client);
  } else {
    if (!options.url) throw new Error('DATABASE_URL is required when ARCHIVE_DATA_MODE=database.');
    const client = postgres(options.url, {
      prepare: false,
      max: 5,
      connect_timeout: 8,
      idle_timeout: 20,
    });
    const wrap = (connection: postgres.Sql | postgres.TransactionSql): Store => ({
      query: async <T>(sql: string, values: unknown[] = []) => ({
        rows: [...(await connection.unsafe(sql, values as never[]))] as T[],
      }),
      exec: async (sql) => {
        await connection.unsafe(sql);
      },
      transaction: (fn) =>
        'begin' in connection
          ? ((connection as postgres.Sql).begin((tx) => fn(wrap(tx))) as Promise<
              Awaited<ReturnType<typeof fn>>
            >)
          : fn(wrap(connection)),
      orm: postgresDrizzle(client),
      dialect: 'database',
      close: () => client.end({ timeout: 2 }),
    });
    store = wrap(client);
  }
  try {
    if (options.migrate ?? options.mode === 'local') await migrateStore(store);
    if (options.mode === 'local' && (options.seed ?? true)) {
      await store.transaction(async (tx) => {
        await tx.exec(
          'CREATE TABLE IF NOT EXISTS archive.initialization (name text PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT now());',
        );
        const seeded = await tx.query('SELECT name FROM archive.initialization WHERE name = $1', [
          'initial-fixtures',
        ]);
        if (!seeded.rows.length) {
          await seedArchive(tx, fixtureArchive);
          await tx.query('INSERT INTO archive.initialization (name) VALUES ($1)', [
            'initial-fixtures',
          ]);
        }
      });
    }
    return store;
  } catch (error) {
    await store.close();
    throw error;
  }
}

type State = { stores: Map<string, Promise<Store>>; testStore?: Store };
const globalState = globalThis as typeof globalThis & { __southViewStores?: State };
const state: State = (globalState.__southViewStores ??= { stores: new Map() });

export function setStoreForTests(store: Store | undefined) {
  state.testStore = store;
}

export async function getStore(): Promise<Store> {
  if (state.testStore) return state.testStore;
  const mode = dataMode();
  if (mode === 'fixture')
    throw new Error('Fixture mode is read-only. Select local or database mode to contribute.');
  let options: StoreOptions;
  let key: string;
  if (mode === 'database') {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is required when ARCHIVE_DATA_MODE=database.');
    options = { mode, url };
    key = `database:${url}`;
  } else {
    const path = process.env.ARCHIVE_LOCAL_PATH;
    const dataRoot = process.env.SOUTHVIEW_DATA_DIR
      ? resolve(projectRoot(), process.env.SOUTHVIEW_DATA_DIR)
      : join(projectRoot(), '.southview');
    const localPath = path
      ? isAbsolute(path)
        ? path
        : resolve(projectRoot(), path)
      : join(dataRoot, 'db');
    options = { mode, path: localPath };
    key = `local:${localPath}`;
  }
  let pending = state.stores.get(key);
  if (!pending) {
    pending = createStore(options);
    state.stores.set(key, pending);
    pending.catch(() => state.stores.delete(key));
  }
  return pending;
}

export async function closeStores() {
  await Promise.all([...state.stores.values()].map(async (store) => (await store).close()));
  state.stores.clear();
}
