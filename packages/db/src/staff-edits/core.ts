/**
 * How every staff action is written: rows validated and stored one by one, recorded in a
 * batch with the reason, and read back for the history.
 */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  contributionEntrySchema,
  issueSchema,
  materialSchema,
  personSchema,
  placeSchema,
  relationSchema,
  sourceSchema,
  type Actor,
  type Place,
  type StaffEdit,
} from '@southview/validators';
import type { Store } from '../connection';
import { DomainError, requireReviewer, writableStore } from '../community';

export type Table = StaffEdit['targetTable'];

export type Data = Record<string, unknown>;

/** One row a staff action writes: `next` null removes the row. */
export type StaffChange = { table: Table; id: string; next: Data | null };

export type EditRow = {
  id: string;
  batch_id: string;
  target_table: Table;
  target_id: string;
  reason: string;
  previous_data: Data | null;
  next_data: Data | null;
  undo_of: string | null;
  undone_at: Date | string | null;
  created_at: Date | string;
  actor_email: string | null;
};

export const editSelect = `SELECT e.id, e.batch_id, e.target_table, e.target_id, e.reason, e.previous_data, e.next_data, e.undo_of, e.undone_at, e.created_at, u.email AS actor_email FROM community.staff_edits e LEFT JOIN community.auth_user u ON u.id = e.actor_id`;

export const schemas = {
  persons: personSchema,
  places: placeSchema,
  person_places: relationSchema,
  materials: materialSchema,
  sources: sourceSchema,
  issues: issueSchema,
  contributions: contributionEntrySchema,
} as const;

function changedFields(previous: Data | null, next: Data | null) {
  const keys = new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})]);
  return [...keys].filter((key) => !isDeepStrictEqual(previous?.[key], next?.[key])).sort();
}

export function toEdit(row: EditRow): StaffEdit {
  return {
    id: row.id,
    batchId: row.batch_id,
    targetTable: row.target_table,
    targetId: row.target_id,
    reason: row.reason,
    actorEmail: row.actor_email,
    createdAt: new Date(row.created_at).toISOString(),
    changedFields: changedFields(row.previous_data, row.next_data),
    previous: row.previous_data,
    next: row.next_data,
    undoOf: row.undo_of,
    undoneAt: row.undone_at ? new Date(row.undone_at).toISOString() : null,
  };
}

export async function readRow(tx: Store, table: Table, id: string): Promise<Data | null> {
  return (
    (
      await tx.query<{ data: Data }>(`SELECT data FROM archive.${table} WHERE id = $1 FOR UPDATE`, [
        id,
      ])
    ).rows[0]?.data ?? null
  );
}

function checkRecord(table: Table, data: Data) {
  const parsed = schemas[table].safeParse(data);
  if (!parsed.success)
    throw new DomainError(
      'BAD_REQUEST',
      parsed.error.issues[0]?.message ?? 'This change would leave the record incomplete.',
    );
  if (table === 'places') {
    const place = parsed.data as Place;
    if ((place.coordinates === null) !== (place.precision === 'unmapped'))
      throw new DomainError(
        'BAD_REQUEST',
        'Choose “Not yet mapped” only for a place without a map position, and a precision for one with a position.',
      );
    if (
      place.coordinates &&
      (place.coordinates[0] < -84.65 ||
        place.coordinates[0] > -84.1 ||
        place.coordinates[1] < 33.5 ||
        place.coordinates[1] > 33.95)
    )
      throw new DomainError('BAD_REQUEST', 'Place positions must be in metropolitan Atlanta.');
  }
}

async function writeRow(tx: Store, table: Table, id: string, data: Data | null) {
  if (data === null) {
    try {
      await tx.query(`DELETE FROM archive.${table} WHERE id = $1`, [id]);
    } catch {
      throw new DomainError(
        'CONFLICT',
        'Other records still depend on this one. Remove or move them first.',
      );
    }
    return;
  }
  const json = JSON.stringify(data);
  if (table === 'person_places')
    await tx.query(
      'INSERT INTO archive.person_places (id, person_id, place_id, data) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO UPDATE SET person_id=EXCLUDED.person_id, place_id=EXCLUDED.place_id, data=EXCLUDED.data',
      [id, data.personId, data.placeId, json],
    );
  else if (table === 'materials')
    await tx.query(
      'INSERT INTO archive.materials (id, person_id, source_id, data) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO UPDATE SET person_id=EXCLUDED.person_id, source_id=EXCLUDED.source_id, data=EXCLUDED.data',
      [id, data.personId, data.sourceId, json],
    );
  else if (table === 'contributions')
    await tx.query(
      'INSERT INTO archive.contributions (id, person_id, credit_id, data) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO UPDATE SET person_id=EXCLUDED.person_id, credit_id=EXCLUDED.credit_id, data=EXCLUDED.data',
      [id, data.personId, data.creditId, json],
    );
  else if (table === 'issues')
    await tx.query(
      'INSERT INTO archive.issues (id, person_id, data) VALUES ($1,$2,$3::jsonb) ON CONFLICT (id) DO UPDATE SET person_id=EXCLUDED.person_id, data=EXCLUDED.data',
      [id, data.personId, json],
    );
  else
    await tx.query(
      `INSERT INTO archive.${table} (id, data) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data`,
      [id, json],
    );
}

/**
 * Writes one staff action, row by row in the given order, and records every row in one batch
 * with the reason. Rows whose content does not change are skipped. Returns null when nothing
 * changed. Parents must come before children when inserting, and after them when removing.
 */
export async function applyStaffChanges(
  tx: Store,
  actor: Actor,
  reason: string,
  changes: StaffChange[],
  undoOf: Map<string, string> = new Map(),
): Promise<string | null> {
  const batchId = randomUUID();
  let wrote = false;
  for (const change of changes) {
    const previous = await readRow(tx, change.table, change.id);
    if (change.next === null && previous === null) continue;
    if (change.next !== null) {
      if (change.next.id !== undefined && change.next.id !== change.id && change.table !== 'issues')
        throw new DomainError('BAD_REQUEST', 'A record cannot change its identifier.');
      checkRecord(change.table, change.next);
      if (previous && isDeepStrictEqual(previous, change.next)) continue;
    }
    await writeRow(tx, change.table, change.id, change.next);
    await tx.query(
      'INSERT INTO community.staff_edits (id, batch_id, actor_id, target_table, target_id, reason, previous_data, next_data, undo_of) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)',
      [
        randomUUID(),
        batchId,
        actor.userId,
        change.table,
        change.id,
        reason,
        previous === null ? null : JSON.stringify(previous),
        change.next === null ? null : JSON.stringify(change.next),
        undoOf.get(`${change.table}:${change.id}`) ?? null,
      ],
    );
    wrote = true;
  }
  return wrote ? batchId : null;
}

export async function batchEdits(tx: Store, batchId: string | null) {
  if (!batchId) return [];
  return (
    await tx.query<EditRow>(`${editSelect} WHERE e.batch_id = $1 ORDER BY e.sequence`, [batchId])
  ).rows.map(toEdit);
}

export async function staffAction<T>(
  actor: Actor,
  run: (tx: Store) => Promise<{ result: T; reason: string; changes: StaffChange[] }>,
): Promise<T & { edits: StaffEdit[] }> {
  requireReviewer(actor);
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const { result, reason, changes } = await run(tx);
    const batchId = await applyStaffChanges(tx, actor, reason, changes);
    return { ...result, edits: await batchEdits(tx, batchId) };
  });
}

export async function existing<T>(
  tx: Store,
  table: Table,
  id: string,
  missing: string,
): Promise<T> {
  const data = await readRow(tx, table, id);
  if (!data) throw new DomainError('NOT_FOUND', missing);
  return data as T;
}

export async function checkRelated(
  tx: Store,
  personId: string,
  related: { relatedPersonIds: string[]; placeIds: string[] },
) {
  if (related.relatedPersonIds.includes(personId))
    throw new DomainError('BAD_REQUEST', 'A record cannot list its own person as related.');
  for (const id of related.relatedPersonIds)
    await existing(tx, 'persons', id, 'A related person is no longer in the archive.');
  for (const id of related.placeIds)
    await existing(tx, 'places', id, 'A related place is no longer in the archive.');
}
