/**
 * The change history of a record, and undoing one staff action.
 */
import { isDeepStrictEqual } from 'node:util';
import { staffReasonSchema, type Actor, type StaffEdit } from '@southview/validators';
import { DomainError, requireReviewer, writableStore } from '../community';
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
    `WITH matched AS (SELECT DISTINCT batch_id FROM community.staff_edits WHERE (target_table = $1 AND target_id = $3) OR (target_table = ANY($4::text[]) AND (previous_data->>$2 = $3 OR next_data->>$2 = $3)) OR (target_table = 'sources' AND $1 = 'persons' AND target_id IN (SELECT source_id FROM archive.materials WHERE person_id = $3))) ${editSelect} WHERE e.batch_id IN (SELECT batch_id FROM matched) ORDER BY e.sequence DESC LIMIT 200`,
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
    }
    const batchId = await applyStaffChanges(tx, actor, reason, changes, undoOf);
    await tx.query('UPDATE community.staff_edits SET undone_at = now() WHERE batch_id = $1', [
      entry.batch_id,
    ]);
    return { edits: await batchEdits(tx, batchId), undone: await batchEdits(tx, entry.batch_id) };
  });
}
