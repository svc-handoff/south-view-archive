import { validateArchive, type ArchiveData } from '@southview/validators';
import { fixtureArchive } from './fixtures';

export class ArchiveConfigurationError extends Error {
  override name = 'ArchiveConfigurationError';
}
export class ArchiveDatabaseError extends Error {
  override name = 'ArchiveDatabaseError';
}

type ArchiveEnvironment = { ARCHIVE_DATA_MODE?: string; DATABASE_URL?: string };
type DatabaseReader = (url: string) => Promise<ArchiveData>;
const readDatabase: DatabaseReader = async (url) =>
  (await import('./database')).readDatabaseArchive(url);

// This seam is server-side dependency injection for tests; it is not a public API input.
export function createArchiveLoader(
  environment: ArchiveEnvironment,
  databaseReader: DatabaseReader = readDatabase,
) {
  return async function loadArchive(): Promise<ArchiveData> {
    const mode = environment.ARCHIVE_DATA_MODE ?? 'local';
    if (mode === 'fixture') return validateArchive(fixtureArchive);
    if (mode !== 'database' && mode !== 'local')
      throw new ArchiveConfigurationError('ARCHIVE_DATA_MODE must be fixture, local, or database.');
    const url = environment.DATABASE_URL;
    if (mode === 'database' && !url)
      throw new ArchiveConfigurationError(
        'DATABASE_URL is required when ARCHIVE_DATA_MODE=database.',
      );
    try {
      return validateArchive(
        mode === 'local'
          ? await (await import('./database')).readCurrentArchive()
          : await databaseReader(url!),
      );
    } catch {
      // Never expose connection strings, query parameters, or driver diagnostics publicly.
      throw new ArchiveDatabaseError(
        'The archive database could not be loaded. Check connectivity and migrations.',
      );
    }
  };
}

export async function getArchive(): Promise<ArchiveData> {
  const mode = process.env.ARCHIVE_DATA_MODE ?? 'local';
  if (mode === 'fixture') return validateArchive(fixtureArchive);
  if (mode !== 'local' && mode !== 'database')
    throw new ArchiveConfigurationError('ARCHIVE_DATA_MODE must be fixture, local, or database.');
  if (mode === 'database' && !process.env.DATABASE_URL)
    throw new ArchiveConfigurationError(
      'DATABASE_URL is required when ARCHIVE_DATA_MODE=database.',
    );
  try {
    return await (await import('./database')).readCurrentArchive();
  } catch {
    throw new ArchiveDatabaseError(
      'The archive database could not be loaded. Check connectivity and migrations.',
    );
  }
}
