'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, BookText, LoaderCircle, Plus, Trash2, X } from 'lucide-react';
import type { ArchiveData, Person, StaffEdit } from '@southview/validators';
import { CommunityNotice } from './community-shell';
import { ReasonField, personSourceIds, savedMessage, useStaffRequest } from './admin-shared';

type Citation = { sourceId: string; locator: string };
type Draft = { key: string; from?: number; text: string; citations: Citation[] };
type Paragraph = Person['biography'][number];

const draftsFor = (biography: Paragraph[]): Draft[] =>
  biography.map((paragraph, index) => ({
    key: `p${index}`,
    from: index,
    text: paragraph.text,
    citations: paragraph.citations.map((citation) => ({
      sourceId: citation.sourceId,
      locator: citation.locator ?? '',
    })),
  }));
const comparable = (drafts: Draft[]) =>
  JSON.stringify(
    drafts.map((draft) => ({
      from: draft.from,
      text: draft.text.trim(),
      citations: draft.citations.map((c) => [c.sourceId, c.locator.trim()]),
    })),
  );
let counter = 0;

/**
 * The person's story, paragraph by paragraph: correct the text and its sources, move, remove or
 * add paragraphs, then save all of it with one reason.
 */
export function StoryEditor({
  person,
  archive,
  onDirtyChange,
  onSaved,
}: {
  person: Person;
  archive: ArchiveData;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (edits: StaffEdit[], message: string) => void;
}) {
  const [base, setBase] = useState<Paragraph[]>(person.biography);
  const [drafts, setDrafts] = useState<Draft[]>(() => draftsFor(person.biography));
  const [reason, setReason] = useState('');
  const { busy, error, setError, send } = useStaffRequest();
  const dirty = comparable(drafts) !== comparable(draftsFor(base));
  const latest = JSON.stringify(person.biography);
  const loaded = useRef(latest);

  useEffect(() => {
    onDirtyChange(dirty || !!reason.trim());
  }, [dirty, reason, onDirtyChange]);
  // An undo or another save changed the story: show it, unless there are unsaved edits here.
  useEffect(() => {
    if (latest === loaded.current || dirty) return;
    loaded.current = latest;
    setBase(person.biography);
    setDrafts(draftsFor(person.biography));
  }, [latest, dirty, person.biography]);

  const own = personSourceIds(person, archive);
  const sources = [...archive.sources].sort(
    (a, b) => Number(own.has(b.id)) - Number(own.has(a.id)) || a.title.localeCompare(b.title),
  );
  const credit = (index: number | undefined) => {
    if (index === undefined) return 'New paragraph';
    const ids = base[index]?.creditIds ?? [];
    const names = ids.map(
      (id) => archive.credits.find((item) => item.id === id)?.displayName ?? 'Unknown contributor',
    );
    return `Credited to ${names.join(', ')}`;
  };

  function update(key: string, change: (draft: Draft) => Draft) {
    setDrafts((current) => current.map((draft) => (draft.key === key ? change(draft) : draft)));
    setError('');
  }
  function move(index: number, by: number) {
    setDrafts((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  }
  function add() {
    counter += 1;
    setDrafts((current) => [
      ...current,
      {
        key: `new${counter}`,
        text: '',
        citations:
          sources[0] && own.has(sources[0].id) ? [{ sourceId: sources[0].id, locator: '' }] : [],
      },
    ]);
  }

  async function save() {
    const empty = drafts.findIndex((draft) => !draft.text.trim());
    if (empty >= 0) {
      setError(`Paragraph ${empty + 1} is empty. Write it or remove it.`);
      return;
    }
    const uncited = drafts.findIndex((draft) => !draft.citations.length);
    if (uncited >= 0) {
      setError(`Paragraph ${uncited + 1} needs at least one source.`);
      return;
    }
    const edits = await send(
      `/admin/persons/${encodeURIComponent(person.id)}/biography`,
      {
        base,
        paragraphs: drafts.map((draft) => ({
          ...(draft.from === undefined ? {} : { from: draft.from }),
          text: draft.text.trim(),
          citations: draft.citations.map((citation) => ({
            sourceId: citation.sourceId,
            ...(citation.locator.trim() ? { locator: citation.locator.trim() } : {}),
          })),
        })),
      },
      reason,
      {
        missingReason: 'Say briefly why you are changing the story.',
        failure: 'The story could not be saved.',
      },
    );
    if (!edits) return;
    const saved = edits.find((edit) => edit.targetTable === 'persons')?.next as Person | undefined;
    if (saved) {
      loaded.current = JSON.stringify(saved.biography);
      setBase(saved.biography);
      setDrafts(draftsFor(saved.biography));
    }
    setReason('');
    onSaved(edits, savedMessage(edits, 'Saved the story.'));
  }

  return (
    <section className="admin-section" aria-labelledby="admin-story-heading">
      <h3 id="admin-story-heading">
        <BookText size={18} aria-hidden="true" /> Story
      </h3>
      <p className="admin-history-note">
        The paragraphs of the person page, in order. Each one cites at least one source. A corrected
        paragraph keeps its credit.
      </p>
      {!drafts.length && <p className="admin-history-note">No paragraphs yet.</p>}
      <ol className="admin-story">
        {drafts.map((draft, index) => (
          <li key={draft.key}>
            <div className="admin-story-head">
              <strong>Paragraph {index + 1}</strong>
              <span>{credit(draft.from)}</span>
              <div className="admin-link-actions">
                <button
                  type="button"
                  className="community-text-button"
                  disabled={index === 0}
                  aria-label={`Move paragraph ${index + 1} up`}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="community-text-button"
                  disabled={index === drafts.length - 1}
                  aria-label={`Move paragraph ${index + 1} down`}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="community-text-button admin-danger"
                  aria-label={`Remove paragraph ${index + 1}`}
                  onClick={() =>
                    setDrafts((current) => current.filter((item) => item.key !== draft.key))
                  }
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
            <label className="community-field">
              <span className="sr-only">Text of paragraph {index + 1}</span>
              <textarea
                rows={Math.min(12, Math.max(3, Math.ceil(draft.text.length / 90)))}
                maxLength={20000}
                value={draft.text}
                onChange={(event) =>
                  update(draft.key, (item) => ({ ...item, text: event.target.value }))
                }
              />
            </label>
            <div className="admin-citations" aria-label={`Sources for paragraph ${index + 1}`}>
              {draft.citations.map((citation, at) => (
                <div className="admin-citation" key={`${citation.sourceId}-${at}`}>
                  <span>
                    {archive.sources.find((source) => source.id === citation.sourceId)?.title ??
                      citation.sourceId}
                  </span>
                  <input
                    value={citation.locator}
                    maxLength={200}
                    placeholder="Page or section"
                    aria-label="Page or section, optional"
                    onChange={(event) =>
                      update(draft.key, (item) => ({
                        ...item,
                        citations: item.citations.map((c, i) =>
                          i === at ? { ...c, locator: event.target.value } : c,
                        ),
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="community-text-button"
                    aria-label="Remove this source"
                    onClick={() =>
                      update(draft.key, (item) => ({
                        ...item,
                        citations: item.citations.filter((_, i) => i !== at),
                      }))
                    }
                  >
                    <X size={15} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <label className="admin-citation-add">
                <span className="sr-only">Cite another source</span>
                <select
                  value=""
                  onChange={(event) => {
                    const sourceId = event.target.value;
                    if (sourceId)
                      update(draft.key, (item) => ({
                        ...item,
                        citations: [...item.citations, { sourceId, locator: '' }],
                      }));
                  }}
                >
                  <option value="">+ Cite a source</option>
                  {sources
                    .filter((source) => !draft.citations.some((c) => c.sourceId === source.id))
                    .map((source) => (
                      <option key={source.id} value={source.id}>
                        {own.has(source.id) ? '' : '(not yet on this page) '}
                        {source.title}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="community-secondary" onClick={add}>
        <Plus size={16} aria-hidden="true" /> Add a paragraph
      </button>
      {(dirty || error) && (
        <div className="admin-link-editor">
          {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
          <ReasonField
            label="Reason for changing the story *"
            value={reason}
            onChange={setReason}
            placeholder="For example: second paragraph corrected against the obituary"
          />
          <div className="admin-form-actions">
            <button
              type="button"
              className="community-primary"
              disabled={busy || !dirty}
              onClick={() => void save()}
            >
              {busy && <LoaderCircle size={16} className="community-spinner" />} Save the story
            </button>
            <button
              type="button"
              className="community-text-button"
              onClick={() => {
                setDrafts(draftsFor(base));
                setReason('');
                setError('');
              }}
            >
              Discard changes
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
