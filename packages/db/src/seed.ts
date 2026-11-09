import { createHash } from 'node:crypto';
import { validateArchive, type ArchiveData } from '@southview/validators';

export type SeedStatement = { text: string; values: (string | null)[] };

export function assertSeedAllowed(
  environment: { NODE_ENV?: string },
  arguments_: readonly string[],
) {
  if (!arguments_.includes('--confirm'))
    throw new Error(
      'Seeding requires --confirm. Database mode also requires MIGRATION_DATABASE_URL.',
    );
  if (environment.NODE_ENV === 'production' && !arguments_.includes('--allow-production')) {
    throw new Error('Production seeding is disabled. Explicit --allow-production is required.');
  }
}

// Only insert missing records: existing curator edits and later contributions win.
export function buildSeedStatements(input: ArchiveData): SeedStatement[] {
  const data = validateArchive(input);
  const statements: SeedStatement[] = [];
  for (const [table, records] of [
    ['sources', data.sources],
    ['persons', data.people],
    ['places', data.places],
  ] as const) {
    for (const record of records)
      statements.push({
        text: `INSERT INTO archive.${table} (id, data) VALUES ($1, $2::jsonb) ON CONFLICT DO NOTHING`,
        values: [record.id, JSON.stringify(record)],
      });
  }
  for (const record of data.relations)
    statements.push({
      text: 'INSERT INTO archive.person_places (id, person_id, place_id, data) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING',
      values: [record.id, record.personId, record.placeId, JSON.stringify(record)],
    });
  for (const record of data.materials)
    statements.push({
      text: 'INSERT INTO archive.materials (id, person_id, source_id, data) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING',
      values: [record.id, record.personId, record.sourceId, JSON.stringify(record)],
    });
  for (const record of data.issues) {
    const id = createHash('sha256')
      .update(JSON.stringify([record.personId, record.field, [...record.sourceIds].sort()]))
      .digest('hex');
    statements.push({
      text: 'INSERT INTO archive.issues (id, person_id, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT DO NOTHING',
      values: [id, record.personId, JSON.stringify(record)],
    });
  }
  for (const record of data.crosswalk)
    statements.push({
      text: 'INSERT INTO archive.crosswalk (project, external_id, person_id, data) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING',
      values: [record.project, record.externalId, record.personId, JSON.stringify(record)],
    });
  return statements;
}

/** The caller must supply a transaction-bound connection. */
export async function seedArchive(
  transaction: { query: (text: string, values: (string | null)[]) => Promise<unknown> },
  data: ArchiveData,
) {
  const statements = buildSeedStatements(data);
  for (const statement of statements) await transaction.query(statement.text, statement.values);
  return statements.length;
}
