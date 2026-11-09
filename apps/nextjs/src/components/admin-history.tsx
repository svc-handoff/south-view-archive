'use client';
import { useCallback, useEffect, useState } from 'react';
import { History, LoaderCircle, Undo2 } from 'lucide-react';
import {
  formatEventDate,
  formatLifeDate,
  type ArchiveData,
  type EventDate,
  type StaffEdit,
} from '@southview/validators';
import { communityRequest } from '@/lib/community-client';
import { displayPersonName } from '@/lib/person-name';
import { CommunityNotice } from './community-shell';
import { ReasonField, useStaffRequest } from './admin-shared';

export const fieldLabels: Record<string, string> = {
  name: 'Name',
  aliases: 'Other names',
  birthYear: 'Birth year',
  deathYear: 'Death year',
  birthDate: 'Full birth date',
  deathDate: 'Full death date',
  themes: 'Themes',
  occupations: 'Occupations',
  summary: 'Summary',
  summaryCitations: 'Summary sources',
  biography: 'Story',
  portrait: 'Portrait',
  creditIds: 'Credits',
  scope: 'Area',
  address: 'Address',
  coordinates: 'Map position',
  coordinateCitations: 'Position sources',
  precision: 'Precision',
  locationNote: 'Location note',
  label: 'Relationship',
  description: 'Description',
  citations: 'Sources',
  personId: 'Person',
  placeId: 'Place',
  title: 'Title',
  kind: 'Type',
  narrator: 'Narrator',
  interviewer: 'Interviewer',
  date: 'Recorded',
  eventDate: 'Events date',
  relatedPersonIds: 'Related people',
  placeIds: 'Related places',
  sourceId: 'Collection link',
  creator: 'Creator',
  publisher: 'Held by',
  url: 'Web address',
  rights: 'Rights',
  field: 'Concerns',
  note: 'Note',
  sourceIds: 'Sources',
  body: 'Public text',
  context: 'Context',
  sourceCreator: 'Created by',
  holdingInstitution: 'Held by',
  featured: 'Featured',
  publicNote: 'Public note',
  photos: 'Photographs',
};
type Paragraph = { id?: string; text: string; citations: unknown[] };
/** What one change did to a story, in words: "2 rewritten, 1 added, order changed". */
function storyChange(previous: unknown, next: unknown) {
  const before = (Array.isArray(previous) ? previous : []) as Paragraph[];
  const after = (Array.isArray(next) ? next : []) as Paragraph[];
  const key = (item: Paragraph) => item.id ?? `text:${item.text}`;
  const beforeKeys = before.map(key);
  const afterKeys = after.map(key);
  let rewritten = 0;
  for (const item of after) {
    const old = item.id ? before.find((other) => other.id === item.id) : undefined;
    if (old && JSON.stringify(old) !== JSON.stringify(item)) rewritten += 1;
  }
  const added = afterKeys.filter((k) => !beforeKeys.includes(k)).length;
  const removed = beforeKeys.filter((k) => !afterKeys.includes(k)).length;
  // An unlabelled paragraph whose text changed reads as one removed and one added.
  const replaced = Math.min(added, removed);
  const shared = afterKeys.filter((k) => beforeKeys.includes(k));
  const reordered =
    JSON.stringify(shared) !== JSON.stringify(beforeKeys.filter((k) => afterKeys.includes(k)));
  const parts = [
    rewritten + replaced ? `${rewritten + replaced} rewritten` : '',
    added - replaced ? `${added - replaced} added` : '',
    removed - replaced ? `${removed - replaced} removed` : '',
    reordered ? 'order changed' : '',
  ].filter(Boolean);
  return `${parts.join(', ') || 'sources changed'} (${before.length} → ${after.length} paragraphs)`;
}
function shown(field: string, value: unknown) {
  if (value === undefined || value === null || value === '') return '—';
  if ((field === 'birthDate' || field === 'deathDate') && typeof value === 'string')
    return formatLifeDate(undefined, value) ?? value;
  if (field === 'eventDate' && typeof value === 'object')
    return formatEventDate(value as EventDate);
  if (field === 'coordinates' && Array.isArray(value))
    return value.map((n) => Number(n).toFixed(5)).join(', ');
  // Lists of record identifiers mean nothing to staff; their count does.
  if (field.endsWith('Ids') && Array.isArray(value))
    return value.length ? `${value.length} chosen` : 'none';
  if (Array.isArray(value))
    return value.every((item) => typeof item === 'string')
      ? value.join(', ') || '—'
      : `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return 'changed';
  const text = String(value);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

/** Loads the change history from an admin endpoint and reloads it on demand. */
export function useStaffHistory(path: string) {
  const [history, setHistory] = useState<StaffEdit[] | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      setHistory((await communityRequest<{ edits: StaffEdit[] }>(path)).edits);
      setError('');
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'The change history could not be loaded.',
      );
    }
  }, [path]);
  useEffect(() => {
    setHistory(null);
    void reload();
  }, [reload]);
  return { history, error, reload };
}

function describe(edit: StaffEdit, archive: ArchiveData) {
  const data = (edit.next ?? edit.previous ?? {}) as Record<string, unknown>;
  const action = edit.previous === null ? 'Added' : edit.next === null ? 'Removed' : 'Changed';
  if (edit.targetTable === 'persons') return `${action} person record`;
  if (edit.targetTable === 'places')
    return `${action} place: ${String(data.name ?? edit.targetId)}`;
  if (edit.targetTable === 'person_places') {
    const person = archive.people.find((item) => item.id === data.personId);
    const place = archive.places.find((item) => item.id === data.placeId);
    return `${action} connection: ${person ? displayPersonName(person.name) : 'a person'} — ${place?.name ?? 'a place'}`;
  }
  if (edit.targetTable === 'materials')
    return `${action} ${data.kind === 'oral-history' ? 'oral history' : 'record'}: ${String(data.title ?? '')}`;
  if (edit.targetTable === 'sources')
    return `${action} ${String(data.url ?? '').startsWith('/contributions/') ? 'contribution source' : 'collection link'}: ${String(data.title ?? edit.targetId)}`;
  if (edit.targetTable === 'issues') return `${action} note on this record`;
  if (edit.targetTable === 'contributions')
    return `${action} published contribution: ${String(data.title ?? '')}`;
  return `${action} ${edit.targetTable}`;
}

/**
 * Staff changes grouped by action, newest first, each with the reason and an Undo for the whole
 * action. `onUndone` receives the rows the undo wrote.
 */
export function ChangeHistory({
  history,
  error,
  archive,
  note,
  onUndone,
}: {
  history: StaffEdit[] | null;
  error: string;
  archive: ArchiveData;
  note: string;
  onUndone: (edits: StaffEdit[]) => void;
}) {
  const [undoing, setUndoing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const { busy, error: undoError, setError: setUndoError, send } = useStaffRequest();
  const batches: StaffEdit[][] = [];
  for (const edit of history ?? []) {
    const last = batches.at(-1);
    if (last && last[0]!.batchId === edit.batchId) last.push(edit);
    else batches.push([edit]);
  }

  async function undo(editId: string) {
    const edits = await send(`/admin/edits/${encodeURIComponent(editId)}/undo`, {}, reason, {
      missingReason: 'Say briefly why you are undoing this change.',
      failure: 'The change could not be undone.',
    });
    if (!edits) return;
    setUndoing(null);
    setReason('');
    onUndone(edits);
  }

  return (
    <section className="admin-history" aria-labelledby="admin-history-heading">
      <h3 id="admin-history-heading">
        <History size={18} aria-hidden="true" /> Change history
      </h3>
      <p className="admin-history-note">{note}</p>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      {history === null && !error && <p className="admin-history-note">Loading…</p>}
      {history?.length === 0 && <p className="admin-history-note">No direct corrections yet.</p>}
      <ol>
        {batches.map((batch) => {
          const first = batch[0]!;
          const undone = batch.some((edit) => edit.undoneAt);
          const isUndo = batch.some((edit) => edit.undoOf);
          return (
            <li key={first.batchId} className={undone ? 'is-undone' : undefined}>
              <div className="admin-history-meta">
                <time dateTime={first.createdAt}>
                  {new Date(first.createdAt).toLocaleString('en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </time>
                <span>{first.actorEmail ?? 'Staff'}</span>
                {isUndo && <span className="admin-history-tag">Undo</span>}
                {undone && <span className="admin-history-tag">Undone</span>}
              </div>
              <p className="admin-history-reason">{first.reason}</p>
              {batch.map((edit) => (
                <div className="admin-history-row" key={edit.id}>
                  <strong>{describe(edit, archive)}</strong>
                  {edit.previous !== null && edit.next !== null && (
                    <dl>
                      {edit.changedFields
                        .filter((field) => field !== 'updatedAt')
                        .map((field) => (
                          <div key={field}>
                            <dt>{fieldLabels[field] ?? field}</dt>
                            {field === 'biography' ? (
                              <dd>{storyChange(edit.previous?.[field], edit.next?.[field])}</dd>
                            ) : (
                              <dd>
                                <span>{shown(field, edit.previous?.[field])}</span>
                                <span aria-hidden="true"> → </span>
                                <span className="sr-only"> changed to </span>
                                <span>{shown(field, edit.next?.[field])}</span>
                              </dd>
                            )}
                          </div>
                        ))}
                    </dl>
                  )}
                </div>
              ))}
              {!undone && !isUndo && (
                <div className="admin-undo">
                  {undoing === first.batchId ? (
                    <>
                      <ReasonField
                        label="Why undo this change?"
                        value={reason}
                        onChange={setReason}
                        hint={null}
                        autoFocus
                      />
                      {undoError && <CommunityNotice kind="error">{undoError}</CommunityNotice>}
                      <div className="admin-form-actions">
                        <button
                          className="community-secondary"
                          disabled={busy}
                          onClick={() => void undo(first.id)}
                        >
                          {busy ? (
                            <LoaderCircle size={16} className="community-spinner" />
                          ) : (
                            <Undo2 size={16} aria-hidden="true" />
                          )}
                          Undo this change
                        </button>
                        <button
                          className="community-text-button"
                          onClick={() => {
                            setUndoing(null);
                            setUndoError('');
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      className="community-text-button"
                      onClick={() => {
                        setUndoing(first.batchId);
                        setReason('');
                        setUndoError('');
                      }}
                    >
                      <Undo2 size={16} aria-hidden="true" /> Undo
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
