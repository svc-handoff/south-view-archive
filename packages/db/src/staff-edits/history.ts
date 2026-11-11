/**
 * The change history of a record, and undoing one staff action.
 */
import { isDeepStrictEqual } from 'node:util';
import { staffReasonSchema, type Actor, type StaffEdit } from '@southview/validators';
import { DomainError, checkGraveLinks, requireReviewer, writableStore } from '../community';
import { revertChange } from '../revert';
import {
  type Data,
  type StaffChange,
  type EditRow,
  editSelect,
  schemas,
  toEdit,
  readRow,
  applyStaffChanges,
  batchEdits,
} from './core';

export async function listStaffEdits(
  target: { personId: string } | { placeId: string },
  actor: Actor,
): Promise<StaffEdit[]> {
  requireReviewer(actor);
  const store = await writableStore();
  const [own, field, id, children] =
    'personId' in target
      ? ([
          'persons',
          'personId',
          target.personId,
          ['person_places', 'materials', 'issues', 'contributions'],
        ] as const)
      : (['places', 'placeId', target.placeId, ['person_places']] as const);
  const rows = await store.query<EditRow>(
    `WITH matched AS (SELECT DISTINCT batch_id FROM community.staff_edits WHERE (target_table = $1 AND target_id = $3) OR (target_table = ANY($4::text[]) AND (previous_data->>$2 = $3 OR next_data->>$2 = $3)) OR (target_table = 'sources' AND $1 = 'persons' AND target_id IN (SELECT source_id FROM archive.materials WHERE person_id = $3)) OR (target_table = 'places' AND $1 = 'persons' AND target_id IN (SELECT place_id FROM archive.person_places WHERE person_id = $3))) ${editSelect} WHERE e.batch_id IN (SELECT batch_id FROM matched) ORDER BY e.sequence DESC LIMIT 200`,
    [own, field, id, `{${children.join(',')}}`],
  );
  return rows.rows.map(toEdit);
}

/**
 * Undoes the staff action an entry belongs to, all its rows together. Edited fields go back only
 * where they still hold what the action wrote; a removed row comes back; an added row goes away
 * unless it has been changed since.
 */
export async function undoStaffEdit(editId: string, rawReason: string, actor: Actor) {
  requireReviewer(actor);
  const reason = staffReasonSchema.parse(rawReason);
  const store = await writableStore();
  return store.transaction(async (tx) => {
    const entry = (await tx.query<EditRow>(`${editSelect} WHERE e.id = $1`, [editId])).rows[0];
    if (!entry) throw new DomainError('NOT_FOUND', 'This change is not in the history.');
    const rows = (
      await tx.query<EditRow>(
        `${editSelect} WHERE e.batch_id = $1 ORDER BY e.sequence DESC FOR UPDATE OF e`,
        [entry.batch_id],
      )
    ).rows;
    if (rows.some((row) => row.undone_at))
      throw new DomainError('CONFLICT', 'This change was already undone.');
    if (rows.some((row) => row.undo_of))
      throw new DomainError(
        'CONFLICT',
        'This entry is itself an undo. Make a new correction instead.',
      );
    const changes: StaffChange[] = [];
    const undoOf = new Map<string, string>();
    // Related places an undo puts back on a record, checked once every row is back in place.
    const graveChecks: { personId: string | null; placeIds: string[] }[] = [];
    for (const row of rows) {
      const current = await readRow(tx, row.target_table, row.target_id);
      let next: Data | null;
      if (row.previous_data === null) {
        // The action added this row: take it away again, unless someone has edited it since.
        if (current && !isDeepStrictEqual(current, row.next_data))
          throw new DomainError(
            'CONFLICT',
            'A record this change added has been edited since. Remove it directly instead.',
          );
        next = null;
      } else if (row.next_data === null) {
        // The action removed this row: put it back, unless it has been recreated since.
        if (current)
          throw new DomainError('CONFLICT', 'A record this change removed exists again.');
        next = row.previous_data;
      } else {
        if (!current)
          throw new DomainError(
            'CONFLICT',
            'This record has been removed since; it cannot be undone.',
          );
        next = revertChange(row.previous_data, row.next_data, current) as Data;
        if (!schemas[row.target_table].safeParse(next).success)
          throw new DomainError(
            'CONFLICT',
            'Later changes to this record cannot be separated from this one. Correct the record directly instead.',
          );
      }
      changes.push({ table: row.target_table, id: row.target_id, next });
      undoOf.set(`${row.target_table}:${row.target_id}`, row.id);
      if (next && (row.target_table === 'materials' || row.target_table === 'contributions')) {
        const before = new Set((current?.placeIds as string[] | undefined) ?? []);
        const added = ((next.placeIds as string[] | undefined) ?? []).filter(
          (id) => !before.has(id),
        );
        if (added.length)
          graveChecks.push({
            personId: (next.personId as string | undefined) ?? null,
            placeIds: added,
          });
      }
    }
    const batchId = await applyStaffChanges(tx, actor, reason, changes, undoOf);
    // An undo never puts someone else's grave back among a record's related places. Checked
    // after the rows are written, so a restore that also brings back a burial link passes.
    for (const check of graveChecks) await checkGraveLinks(tx, check.personId, check.placeIds);
    await tx.query('UPDATE community.staff_edits SET undone_at = now() WHERE batch_id = $1', [
      entry.batch_id,
    ]);
    return { edits: await batchEdits(tx, batchId), undone: await batchEdits(tx, entry.batch_id) };
  });
}
