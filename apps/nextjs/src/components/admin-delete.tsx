'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore, LoaderCircle, Trash2 } from 'lucide-react';
import type { StaffEdit } from '@southview/validators';
import { communityRequest } from '@/lib/community-client';
import { displayPersonName } from '@/lib/person-name';
import { CommunityNotice } from './community-shell';
import { ReasonField, errorText, hasReason, useStaffRequest } from './admin-shared';

type Kind = 'person' | 'place';
type Impact = {
  removes: { links: number; materials: number; issues: number };
  mentions: number;
  blockers: string[];
};
const area = (kind: Kind) => (kind === 'person' ? 'persons' : 'places');
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Deletes a person or place after showing what goes with it. Anything that must be resolved
 * first is listed instead of the delete button.
 */
export function DeleteRecord({
  kind,
  id,
  name,
  onDeleted,
}: {
  kind: Kind;
  id: string;
  name: string;
  onDeleted: (edits: StaffEdit[]) => void;
}) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [reason, setReason] = useState('');
  const [checking, setChecking] = useState(false);
  const request = useStaffRequest();
  const { error, setError } = request;
  const busy = checking || request.busy;
  const base = `/admin/${area(kind)}/${encodeURIComponent(id)}`;

  async function check() {
    setChecking(true);
    setError('');
    try {
      setImpact(await communityRequest<Impact>(`${base}/deletion`));
    } catch (failure) {
      setError(errorText(failure, 'Could not check what deleting would remove.'));
    } finally {
      setChecking(false);
    }
  }
  async function remove() {
    if (!hasReason(reason)) {
      setError(`Say briefly why you are deleting this ${kind}.`);
      return;
    }
    if (
      !window.confirm(
        `Delete ${name} from the archive? Its public page goes away at once. You can restore it from “Recently deleted”.`,
      )
    )
      return;
    const edits = await request.send(`${base}/delete`, {}, reason, {
      failure: `The ${kind} could not be deleted.`,
    });
    if (edits) onDeleted(edits);
  }

  const removes = impact
    ? [
        impact.removes.links && count(impact.removes.links, 'place connection'),
        impact.removes.materials &&
          count(impact.removes.materials, 'record or oral history', 'records and oral histories'),
        impact.removes.issues && count(impact.removes.issues, 'note'),
      ].filter(Boolean)
    : [];

  return (
    <section className="admin-section admin-delete" aria-labelledby={`admin-delete-${kind}`}>
      <h3 id={`admin-delete-${kind}`}>
        <Trash2 size={18} aria-hidden="true" /> Delete this {kind}
      </h3>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      {!impact ? (
        <>
          <p className="admin-history-note">
            For duplicates and records added by mistake. Deleting removes the public page and
            everything attached to it, and can be undone from “Recently deleted”.
          </p>
          <button
            type="button"
            className="community-text-button admin-danger"
            disabled={busy}
            onClick={() => void check()}
          >
            {busy && <LoaderCircle size={16} className="community-spinner" />} Check what deleting
            would remove
          </button>
        </>
      ) : impact.blockers.length ? (
        <CommunityNotice kind="error" title="This cannot be deleted yet">
          <ul>
            {impact.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </CommunityNotice>
      ) : (
        <div className="admin-link-editor">
          <p>
            Deleting {name} also removes {removes.length ? removes.join(', ') : 'nothing else'}.
            {impact.mentions > 0 &&
              ` ${count(impact.mentions, 'other record or contribution mentions', 'other records and contributions mention')} it and will no longer list it.`}
          </p>
          <ReasonField
            value={reason}
            onChange={setReason}
            placeholder={
              kind === 'person'
                ? 'For example: duplicate of another record'
                : 'For example: added twice'
            }
            hint="Shown to other staff with the restore option. Not shown publicly."
          />
          <div className="admin-form-actions">
            <button
              type="button"
              className="community-primary admin-danger-button"
              disabled={busy}
              onClick={() => void remove()}
            >
              {busy && <LoaderCircle size={16} className="community-spinner" />} Delete {kind}
            </button>
            <button
              type="button"
              className="community-text-button"
              onClick={() => {
                setImpact(null);
                setReason('');
                setError('');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** People or places deleted by staff, each restorable with everything deleted with it. */
export function RecentlyDeleted({
  kind,
  version,
  onRestored,
}: {
  kind: Kind;
  version: number;
  onRestored: (edits: StaffEdit[], id: string) => void;
}) {
  const [items, setItems] = useState<StaffEdit[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const { busy, error, setError, send } = useStaffRequest();
  const load = useCallback(async () => {
    try {
      setItems(
        (await communityRequest<{ edits: StaffEdit[] }>(`/admin/deleted/${area(kind)}`)).edits,
      );
    } catch (failure) {
      setError(errorText(failure, 'The deleted list could not be loaded.'));
    }
  }, [kind]);
  useEffect(() => {
    void load();
  }, [load, version]);

  async function restore(edit: StaffEdit) {
    const edits = await send(`/admin/edits/${encodeURIComponent(edit.id)}/undo`, {}, reason, {
      missingReason: 'Say briefly why you are restoring it.',
      failure: 'It could not be restored.',
    });
    if (!edits) return;
    setOpen(null);
    setReason('');
    onRestored(edits, edit.targetId);
    void load();
  }

  if (!items?.length && !error) return null;
  return (
    <section className="admin-recently-deleted" aria-labelledby={`deleted-${kind}`}>
      <h4 id={`deleted-${kind}`}>Recently deleted</h4>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      <ul className="admin-links">
        {items?.map((edit) => {
          const data = (edit.previous ?? {}) as { name?: string };
          const label =
            kind === 'person'
              ? displayPersonName(data.name ?? edit.targetId)
              : (data.name ?? edit.targetId);
          return (
            <li key={edit.id}>
              <div className="admin-link-summary">
                <div>
                  <strong>{label}</strong>
                  <span>
                    {new Date(edit.createdAt).toLocaleString('en-US', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {' · '}
                    {edit.reason}
                  </span>
                </div>
                <div className="admin-link-actions">
                  <button
                    type="button"
                    className="community-text-button"
                    aria-expanded={open === edit.id}
                    onClick={() => {
                      setOpen(open === edit.id ? null : edit.id);
                      setReason('');
                      setError('');
                    }}
                  >
                    <ArchiveRestore size={16} aria-hidden="true" /> Restore
                  </button>
                </div>
              </div>
              {open === edit.id && (
                <div className="admin-link-editor">
                  <ReasonField
                    label="Why restore it? *"
                    value={reason}
                    onChange={setReason}
                    hint={null}
                    autoFocus
                  />
                  <div className="admin-form-actions">
                    <button
                      type="button"
                      className="community-secondary"
                      disabled={busy}
                      onClick={() => void restore(edit)}
                    >
                      {busy && <LoaderCircle size={16} className="community-spinner" />} Restore
                      with everything deleted with it
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
