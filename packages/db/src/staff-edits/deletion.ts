/**
 * Deleting people and places with everything that depends on them, and restoring them.
 */
import { staffReasonSchema, type Actor, type StaffEdit } from '@southview/validators';
import type { Store } from '../connection';
import { DomainError, requireReviewer, writableStore } from '../community';
import {
  type Table,
  type Data,
  type StaffChange,
  type EditRow,
  editSelect,
  toEdit,
  staffAction,
  existing,
} from './core';

/**
 * Staff changes about one person (their record, place connections, records and notes) or one
 * place (the place and everyone's connections to it), newest first. A person's history also
 * includes corrections to the collection links their records cite.
 */
export type DeletionImpact = {
  /** Rows removed with the record: place connections, and a person's records and notes. */
  removes: { links: number; materials: number; issues: number };
  /** Other records that mention it and lose only the mention. */
  mentions: number;
  /** Why the record cannot be deleted yet; empty when it can. */
  blockers: string[];
};

type DeletionPlan = DeletionImpact & { changes: StaffChange[] };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

async function rowsWhere(tx: Store, table: Table, where: string, id: string) {
  return (
    await tx.query<{ id: string; data: Data }>(
      `SELECT id, data FROM archive.${table} WHERE ${where} ORDER BY id FOR UPDATE`,
      [id],
    )
  ).rows;
}

async function countWhere(tx: Store, sql: string, id: string) {
  return Number((await tx.query<{ n: number | string }>(sql, [id])).rows[0]?.n ?? 0);
}

/**
 * Everything deleting a person or place takes with it, in the order it is written: mentions in
 * other records first, then the rows that depend on it, then the record itself, so one undo puts
 * it all back.
 */
async function planDeletion(
  tx: Store,
  kind: 'person' | 'place',
  id: string,
): Promise<DeletionPlan> {
  const table = kind === 'person' ? 'persons' : 'places';
  await existing(tx, table, id, `This ${kind} is not in the archive.`);
  const listKey = kind === 'person' ? 'relatedPersonIds' : 'placeIds';
  const blockers: string[] = [];
  const open = await countWhere(
    tx,
    kind === 'person'
      ? "SELECT count(*) AS n FROM community.submissions WHERE status IN ('pending','needs-information') AND (input->>'personId' = $1 OR input->'relatedPersonIds' ? $1)"
      : "SELECT count(*) AS n FROM community.submissions WHERE status IN ('pending','needs-information') AND input->'placeIds' ? $1",
    id,
  );
  if (open)
    blockers.push(
      `${plural(open, 'submission')} still under review ${open === 1 ? 'concerns' : 'concern'} this ${kind}. Publish, reject or reassign ${open === 1 ? 'it' : 'them'} on the Contributions tab first.`,
    );
  if (kind === 'person') {
    const about = await countWhere(
      tx,
      'SELECT count(*) AS n FROM archive.contributions WHERE person_id = $1',
      id,
    );
    if (about)
      blockers.push(
        `${plural(about, 'published contribution is', 'published contributions are')} about this person. Withdraw ${about === 1 ? 'it' : 'them'} on the Contributions tab first.`,
      );
    const matched = await countWhere(
      tx,
      'SELECT count(*) AS n FROM archive.crosswalk WHERE person_id = $1',
      id,
    );
    if (matched)
      blockers.push(
        'This person is matched to a record in the South-View Grave Navigation dataset. Removing that match needs a technical volunteer.',
      );
  }

  const changes: StaffChange[] = [];
  let mentions = 0;
  for (const mentioning of ['materials', 'contributions'] as const) {
    for (const row of await rowsWhere(
      tx,
      mentioning,
      `data->'${listKey}' ? $1${kind === 'person' && mentioning === 'materials' ? ' AND person_id <> $1' : ''}`,
      id,
    )) {
      mentions += 1;
      changes.push({
        table: mentioning,
        id: row.id,
        next: { ...row.data, [listKey]: (row.data[listKey] as string[]).filter((v) => v !== id) },
      });
    }
  }
  const links = await rowsWhere(
    tx,
    'person_places',
    kind === 'person' ? 'person_id = $1' : 'place_id = $1',
    id,
  );
  const materials = kind === 'person' ? await rowsWhere(tx, 'materials', 'person_id = $1', id) : [];
  const issues = kind === 'person' ? await rowsWhere(tx, 'issues', 'person_id = $1', id) : [];
  for (const [rows, rowTable] of [
    [links, 'person_places'],
    [materials, 'materials'],
    [issues, 'issues'],
  ] as const)
    for (const row of rows) changes.push({ table: rowTable, id: row.id, next: null });
  changes.push({ table, id, next: null });
  return {
    removes: { links: links.length, materials: materials.length, issues: issues.length },
    mentions,
    blockers,
    changes,
  };
}

/** What deleting a person or place would remove, and anything that prevents it. */
export async function deletionImpact(
  kind: 'person' | 'place',
  id: string,
  actor: Actor,
): Promise<DeletionImpact> {
  requireReviewer(actor);
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const { changes: _changes, ...impact } = await planDeletion(tx, kind, id);
    return impact;
  });
}

/**
 * Deletes a person or place from the archive with everything that depends on it, as one staff
 * action. Undo in the recently deleted list puts all of it back.
 */
export async function deleteRecord(
  kind: 'person' | 'place',
  id: string,
  rawReason: string,
  actor: Actor,
) {
  const reason = staffReasonSchema.parse(rawReason);
  return staffAction(actor, async (tx) => {
    const plan = await planDeletion(tx, kind, id);
    if (plan.blockers.length) throw new DomainError('CONFLICT', plan.blockers.join(' '));
    return { result: {}, reason, changes: plan.changes };
  });
}

/** People or places deleted by staff and not yet restored, newest first. */
export async function listDeleted(kind: 'person' | 'place', actor: Actor): Promise<StaffEdit[]> {
  requireReviewer(actor);
  const table = kind === 'person' ? 'persons' : 'places';
  const store = await writableStore();
  return (
    await store.query<EditRow>(
      `${editSelect} WHERE e.target_table = $1 AND e.next_data IS NULL AND e.previous_data IS NOT NULL AND e.undone_at IS NULL AND e.undo_of IS NULL AND NOT EXISTS (SELECT 1 FROM archive.${table} a WHERE a.id = e.target_id) ORDER BY e.sequence DESC LIMIT 50`,
      [table],
    )
  ).rows.map(toEdit);
}
