'use client';
import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Flower2,
  LoaderCircle,
  MapPin,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import {
  formatLifeDate,
  graveOccupants,
  graveTitle,
  isGrave,
  monthName,
  type ArchiveData,
  type Person,
  type PersonPlace,
  type Place,
  type StaffEdit,
  type StaffPersonEdit,
} from '@southview/validators';
import { displayPersonName } from '@/lib/person-name';
import { precisionLabels } from '@/lib/place-mode';
import { CommunityNotice } from './community-shell';
import { ChangeHistory, fieldLabels, useStaffHistory } from './admin-history';
import { PersonMaterials, PersonNotes } from './person-records-admin';
import { StoryEditor } from './story-admin';
import { PersonContributions } from './contributions-admin';
import {
  ReasonField,
  hasReason,
  personSourceIds,
  savedMessage,
  useStaffRequest,
} from './admin-shared';
import { DeleteRecord, RecentlyDeleted } from './admin-delete';
import { BurialLocate } from './burial-locate';

type Fields = {
  name: string;
  aliases: string;
  birthYear: string;
  birthMonth: string;
  birthDay: string;
  deathYear: string;
  deathMonth: string;
  deathDay: string;
  themes: string;
  occupations: string;
  summary: string;
};
const list = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
function fieldsFor(person: Person): Fields {
  return {
    name: person.name,
    aliases: person.aliases.join(', '),
    birthYear: person.birthYear ? String(person.birthYear) : '',
    birthMonth: person.birthDate ? String(Number(person.birthDate.slice(5, 7))) : '',
    birthDay: person.birthDate?.length === 10 ? String(Number(person.birthDate.slice(8))) : '',
    deathYear: person.deathYear ? String(person.deathYear) : '',
    deathMonth: person.deathDate ? String(Number(person.deathDate.slice(5, 7))) : '',
    deathDay: person.deathDate?.length === 10 ? String(Number(person.deathDate.slice(8))) : '',
    themes: person.themes.join(', '),
    occupations: (person.occupations ?? []).join(', '),
    summary: person.summary,
  };
}
/** Only the fields that differ from the saved record. */
function patchFor(fields: Fields, saved: Fields): StaffPersonEdit['patch'] {
  const patch: StaffPersonEdit['patch'] = {};
  if (fields.name.trim() !== saved.name) patch.name = fields.name.trim();
  if (list(fields.aliases).join(', ') !== saved.aliases) patch.aliases = list(fields.aliases);
  if (list(fields.themes).join(', ') !== saved.themes) patch.themes = list(fields.themes);
  if (list(fields.occupations).join(', ') !== saved.occupations)
    patch.occupations = list(fields.occupations);
  if (fields.summary.trim() !== saved.summary) patch.summary = fields.summary.trim();
  for (const life of ['birth', 'death'] as const) {
    const yearKey = `${life}Year` as const;
    if (fields[yearKey].trim() !== saved[yearKey])
      patch[yearKey] = fields[yearKey].trim() ? Number(fields[yearKey].trim()) : null;
    const date = lifeDate(fields, life);
    if (date !== lifeDate(saved, life)) patch[`${life}Date`] = date;
  }
  return patch;
}
const pad = (value: string, length: number) => value.trim().padStart(length, '0');
/** The full date the year, month and day fields give, or null for the year alone. */
function lifeDate(fields: Fields, life: 'birth' | 'death') {
  const year = fields[`${life}Year`].trim();
  const month = fields[`${life}Month`];
  const day = fields[`${life}Day`].trim();
  if (!year || !month) return null;
  return `${pad(year, 4)}-${pad(month, 2)}${day ? `-${pad(day, 2)}` : ''}`;
}
const years = (person: Person) =>
  person.birthYear || person.deathYear
    ? `${person.birthYear ?? '?'} – ${person.deathYear ?? '?'}`
    : 'Years unknown';
const months = Array.from({ length: 12 }, (_, index) => index + 1);

/** Display names of the people buried in a grave, leaving out `except`. */
const buriedNames = (archive: ArchiveData, placeId: string, except?: string) =>
  graveOccupants(archive, placeId).flatMap((id) => {
    const person = id === except ? undefined : archive.people.find((item) => item.id === id);
    return person ? [displayPersonName(person.name)] : [];
  });
/** "A", "A and B", "A, B and C". */
const joinNames = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '');
/** Whether two names read the same, whatever the spacing (such as the fixed space before Sr.). */
const sameName = (a: string, b: string) =>
  a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
/** A grave as a choice: named by the people buried there, then by its own name when that differs. */
function graveChoice(archive: ArchiveData, place: Place) {
  const title = graveTitle(buriedNames(archive, place.id));
  return sameName(title, place.name) ? title : `${title} · ${place.name}`;
}

export function PeopleAdmin({
  archive,
  initialPersonId,
  initialEntryId,
  onPersonChange,
  onOpenPlace,
  onSaved,
  onDirtyChange,
  confirmLeave,
}: {
  archive: ArchiveData;
  initialPersonId: string | null;
  initialEntryId?: string | null;
  onPersonChange: (personId: string | null) => void;
  onOpenPlace: (placeId: string) => void;
  onSaved: (edits: StaffEdit[]) => void;
  onDirtyChange: (dirty: boolean) => void;
  confirmLeave: () => boolean;
}) {
  const people = [...archive.people].sort((a, b) => a.name.localeCompare(b.name));
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPersonId && people.some((person) => person.id === initialPersonId)
      ? initialPersonId
      : null,
  );
  const [mobileDetail, setMobileDetail] = useState(!!selectedId);
  const [deletedNotice, setDeletedNotice] = useState('');
  const [deletedVersion, setDeletedVersion] = useState(0);
  const visible = people.filter((person) =>
    `${person.name} ${person.aliases.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const selected = people.find((person) => person.id === selectedId) ?? null;

  function choose(personId: string) {
    if (personId === selectedId) {
      setMobileDetail(true);
      return;
    }
    if (!confirmLeave()) return;
    onDirtyChange(false);
    setSelectedId(personId);
    setMobileDetail(true);
    onPersonChange(personId);
  }

  return (
    <div className="review-workspace admin-people" data-mobile-detail={mobileDetail}>
      <aside className="review-queue" aria-label="People in the archive">
        <div className="review-queue-tools">
          <div className="review-section-heading">
            <h2>
              <Users size={19} aria-hidden="true" /> People
            </h2>
            <span aria-live="polite">{visible.length}</span>
          </div>
          <label className="review-search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Search names or other names</span>
            <input
              type="search"
              placeholder="Name or other name"
              value={q}
              maxLength={200}
              onChange={(event) => setQ(event.target.value)}
            />
          </label>
        </div>
        <div className="review-queue-list">
          {visible.map((person) => (
            <button
              className="review-queue-item"
              key={person.id}
              aria-pressed={person.id === selectedId}
              onClick={() => choose(person.id)}
            >
              <strong>{displayPersonName(person.name)}</strong>
              <span className="review-byline">{years(person)}</span>
              {person.themes.length > 0 && (
                <span className="review-row-meta">{person.themes.join(' · ')}</span>
              )}
            </button>
          ))}
          {!visible.length && (
            <div className="review-empty">
              <Users size={28} aria-hidden="true" />
              <h3>No matching people</h3>
              <button className="community-text-button" onClick={() => setQ('')}>
                Clear search
              </button>
            </div>
          )}
        </div>
        <RecentlyDeleted
          kind="person"
          version={deletedVersion}
          onRestored={(edits, personId) => {
            onSaved(edits);
            setDeletedNotice('');
            setSelectedId(personId);
            setMobileDetail(true);
            onPersonChange(personId);
          }}
        />
      </aside>
      <div className="review-detail-scroll">
        <button
          className="review-mobile-back community-text-button"
          onClick={() => setMobileDetail(false)}
        >
          <ArrowLeft size={17} /> Back to people
        </button>
        {selected ? (
          <PersonEditor
            key={selected.id}
            person={selected}
            archive={archive}
            initialEntryId={initialEntryId}
            onDirtyChange={onDirtyChange}
            onSaved={onSaved}
            onDeleted={(edits) => {
              onDirtyChange(false);
              onSaved(edits);
              setSelectedId(null);
              setMobileDetail(false);
              onPersonChange(null);
              setDeletedNotice(`Deleted ${displayPersonName(selected.name)}.`);
              setDeletedVersion((value) => value + 1);
            }}
            onOpenPlace={(placeId) => {
              if (confirmLeave()) {
                onDirtyChange(false);
                onOpenPlace(placeId);
              }
            }}
          />
        ) : (
          <div className="review-empty admin-empty">
            <Users size={28} aria-hidden="true" />
            {deletedNotice && <CommunityNotice kind="success">{deletedNotice}</CommunityNotice>}
            <h3>Choose a person</h3>
            <p>
              Correct names, other names, years, themes, the summary, place connections, records,
              oral histories and notes without a contribution.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function PersonEditor({
  person,
  archive,
  initialEntryId,
  onDeleted,
  onDirtyChange,
  onSaved,
  onOpenPlace,
}: {
  person: Person;
  archive: ArchiveData;
  initialEntryId?: string | null;
  onDeleted: (edits: StaffEdit[]) => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (edits: StaffEdit[]) => void;
  onOpenPlace: (placeId: string) => void;
}) {
  const [savedFields, setSavedFields] = useState(() => fieldsFor(person));
  const [fields, setFields] = useState(savedFields);
  const [reason, setReason] = useState('');
  const { busy, error, setError, send } = useStaffRequest();
  const [notice, setNotice] = useState('');
  const [storyDirty, setStoryDirty] = useState(false);
  const history = useStaffHistory(`/admin/persons/${encodeURIComponent(person.id)}`);
  const patch = patchFor(fields, savedFields);
  const changed = Object.keys(patch);

  useEffect(() => {
    onDirtyChange(changed.length > 0 || !!reason.trim() || storyDirty);
  }, [changed.length, reason, storyDirty, onDirtyChange]);

  function edit(key: keyof Fields, value: string) {
    setFields((current) => ({ ...current, [key]: value }));
    setNotice('');
  }
  /** After any saved change: show the record as stored, and refresh the history. */
  function saved(edits: StaffEdit[], message: string) {
    const record = edits.find((item) => item.targetTable === 'persons')?.next as Person | undefined;
    if (record) {
      const nextFields = fieldsFor(record);
      setSavedFields(nextFields);
      setFields(nextFields);
      setReason('');
    }
    setNotice(message);
    onSaved(edits);
    void history.reload();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!changed.length) return;
    for (const key of ['birthYear', 'deathYear'] as const)
      if (fields[key].trim() && !/^\d{1,4}$/.test(fields[key].trim())) {
        setError('Enter birth and death years as years, or leave them blank.');
        return;
      }
    for (const life of ['birth', 'death'] as const) {
      const day = fields[`${life}Day`].trim();
      if (fields[`${life}Month`] && !fields[`${life}Year`].trim()) {
        setError(`Enter the ${life} year before its month.`);
        return;
      }
      if (day && (!fields[`${life}Month`] || !/^\d{1,2}$/.test(day))) {
        setError(`Choose the ${life} month, and enter the day as a number.`);
        return;
      }
    }
    if (!fields.name.trim()) {
      setError('Enter the person’s public name.');
      return;
    }
    const edits = await send(`/admin/persons/${encodeURIComponent(person.id)}`, { patch }, reason, {
      missingReason:
        'Say briefly why you are making this change. It is shown in the change history.',
    });
    if (edits)
      saved(
        edits,
        savedMessage(edits, 'Saved. The change is live and listed in the history below.'),
      );
  }

  return (
    <section className="review-editor" aria-label={`Edit ${person.name}`}>
      <header className="review-detail-heading admin-heading-split">
        <div>
          <span className="theme-label">Person record</span>
          <h2>{displayPersonName(person.name)}</h2>
          <p>
            <Link href={`/people/${encodeURIComponent(person.id)}`} target="_blank">
              Open the public page <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </p>
        </div>
        <BurialLocate
          person={person}
          archive={archive}
          onSaved={(edits, message) => saved(edits, message)}
        />
      </header>
      <div className="review-detail-content">
        {notice && <CommunityNotice kind="success">{notice}</CommunityNotice>}
        {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
        <form className="admin-form" onSubmit={save}>
          <div className="community-fields">
            <label className="community-field">
              <span>Public name</span>
              <input
                value={fields.name}
                maxLength={160}
                onChange={(event) => edit('name', event.target.value)}
              />
            </label>
            <label className="community-field">
              <span>Other names</span>
              <input
                value={fields.aliases}
                placeholder="Separate names with commas"
                onChange={(event) => edit('aliases', event.target.value)}
              />
            </label>
            <label className="community-field">
              <span>Occupations</span>
              <input
                value={fields.occupations}
                placeholder="For example: Pastor, Civil rights leader"
                onChange={(event) => edit('occupations', event.target.value)}
              />
              <small>
                Separate with commas. Shown as tags on the person page and found by search.
              </small>
            </label>
            {(['birth', 'death'] as const).map((life) => (
              <LifeDateFields key={life} life={life} fields={fields} edit={edit} />
            ))}
            <label className="community-field">
              <span>Themes</span>
              <input
                value={fields.themes}
                placeholder="Separate themes with commas"
                onChange={(event) => edit('themes', event.target.value)}
              />
            </label>
            <label className="community-field">
              <span>Summary</span>
              <textarea
                rows={4}
                maxLength={4000}
                value={fields.summary}
                onChange={(event) => edit('summary', event.target.value)}
              />
            </label>
            <ReasonField
              label="Reason for this change *"
              value={reason}
              onChange={setReason}
              placeholder="For example: birth year checked against the death certificate"
            />
          </div>
          <div className="admin-form-actions">
            <button className="community-primary" disabled={busy || !changed.length}>
              {busy && <LoaderCircle size={16} className="community-spinner" />}
              {changed.length
                ? `Save ${changed.map((key) => fieldLabels[key]?.toLowerCase() ?? key).join(', ')}`
                : 'No changes to save'}
            </button>
            {changed.length > 0 && (
              <button
                type="button"
                className="community-text-button"
                onClick={() => {
                  setFields(savedFields);
                  setReason('');
                }}
              >
                Discard changes
              </button>
            )}
          </div>
        </form>
        <StoryEditor
          person={person}
          archive={archive}
          onDirtyChange={setStoryDirty}
          onSaved={(edits, message) => saved(edits, message)}
        />
        <PersonLinks
          person={person}
          archive={archive}
          onOpenPlace={onOpenPlace}
          onSaved={(edits, message) => saved(edits, message)}
        />
        <PersonMaterials
          person={person}
          archive={archive}
          onSaved={(edits, message) => saved(edits, message)}
        />
        <PersonNotes
          person={person}
          archive={archive}
          onSaved={(edits, message) => saved(edits, message)}
        />
        <PersonContributions
          person={person}
          archive={archive}
          initialEntryId={initialEntryId}
          onSaved={(edits, message) => saved(edits, message)}
        />
        <ChangeHistory
          history={history.history}
          error={history.error}
          archive={archive}
          note="Direct corrections to this person, their story, place connections, records, notes and published contributions. Changes that arrived with a published contribution are on the Contributions tab, and withdrawing one there keeps any later correction."
          onUndone={(edits) =>
            saved(edits, 'Undone. The record is back as it was, apart from later changes.')
          }
        />
        <DeleteRecord
          kind="person"
          id={person.id}
          name={displayPersonName(person.name)}
          onDeleted={onDeleted}
        />
      </div>
    </section>
  );
}

function PersonLinks({
  person,
  archive,
  onOpenPlace,
  onSaved,
}: {
  person: Person;
  archive: ArchiveData;
  onOpenPlace: (placeId: string) => void;
  onSaved: (edits: StaffEdit[], message: string) => void;
}) {
  const links = archive.relations
    .filter((item) => item.personId === person.id)
    .map((link) => ({ link, place: archive.places.find((item) => item.id === link.placeId) }));
  // Where they are buried, kept apart from the places in their life in Atlanta.
  const graveLinks = links.filter(
    (item): item is { link: PersonPlace; place: Place } => !!item.place && isGrave(item.place),
  );
  const placeLinks = links.filter((item) => !item.place || !isGrave(item.place));
  // The one form open: a connection's id, or a new connection to a grave or a place.
  const [open, setOpen] = useState<string | null>(null);

  /** A connection: the place, what connects them, and its Edit form. */
  const row = (
    link: PersonPlace,
    place: Place | undefined,
    details: string[],
    openLabel: string,
  ) => (
    <li key={link.id}>
      <div className="admin-link-summary">
        <div>
          <strong>{place?.name ?? 'Unknown place'}</strong>
          {details.map((text, index) => (
            <span key={index}>{text}</span>
          ))}
        </div>
        <div className="admin-link-actions">
          <button
            className="community-text-button"
            onClick={() => setOpen(open === link.id ? null : link.id)}
            aria-expanded={open === link.id}
          >
            {open === link.id ? 'Close' : 'Edit'}
          </button>
          {place && (
            <button className="community-text-button" onClick={() => onOpenPlace(place.id)}>
              {openLabel}
            </button>
          )}
        </div>
      </div>
      {open === link.id && (
        <LinkEditor
          link={link}
          onSaved={(edits, message) => {
            setOpen(null);
            onSaved(edits, message);
          }}
        />
      )}
    </li>
  );
  const newLink = (burial: boolean) => (
    <NewLink
      person={person}
      archive={archive}
      burial={burial}
      onCancel={() => setOpen(null)}
      onSaved={(edits) => {
        setOpen(null);
        onSaved(
          edits,
          burial
            ? 'Connected. They now appear at this grave on the map.'
            : 'Connected. The place now appears on this person’s page and map.',
        );
      }}
    />
  );

  return (
    <>
      <section className="admin-section" aria-labelledby="admin-grave-heading">
        <h3 id="admin-grave-heading">
          <Flower2 size={18} aria-hidden="true" /> Grave
        </h3>
        {graveLinks.length > 0 ? (
          <ul className="admin-links">
            {graveLinks.map(({ link, place }) => {
              const shared = buriedNames(archive, place.id, person.id);
              return row(
                link,
                place,
                [
                  `${link.label} · ${precisionLabels[place.precision]}`,
                  ...(shared.length ? [`Shared with ${joinNames(shared)}`] : []),
                ],
                'Open grave',
              );
            })}
          </ul>
        ) : (
          <>
            <p className="admin-history-note">
              No grave on the map yet. At the grave, use Map burial here at the top of this record.
            </p>
            {open === 'new:grave' ? (
              newLink(true)
            ) : (
              <button
                type="button"
                className="community-text-button"
                onClick={() => setOpen('new:grave')}
              >
                Share a grave already on the map
              </button>
            )}
          </>
        )}
      </section>
      <section className="admin-section" aria-labelledby="admin-links-heading">
        <h3 id="admin-links-heading">
          <MapPin size={18} aria-hidden="true" /> Places in their life
        </h3>
        {!placeLinks.length && <p className="admin-history-note">No places are connected yet.</p>}
        <ul className="admin-links">
          {placeLinks.map(({ link, place }) => row(link, place, [link.label], 'Open place'))}
        </ul>
        {open === 'new:place' ? (
          newLink(false)
        ) : (
          <button className="community-secondary" onClick={() => setOpen('new:place')}>
            <Plus size={16} aria-hidden="true" /> Connect to a place in Atlanta
          </button>
        )}
      </section>
    </>
  );
}

function LinkEditor({
  link,
  onSaved,
}: {
  link: PersonPlace;
  onSaved: (edits: StaffEdit[], message: string) => void;
}) {
  const [label, setLabel] = useState(link.label);
  const [description, setDescription] = useState(link.description);
  const [reason, setReason] = useState('');
  const request = useStaffRequest();
  const { busy, error, setError } = request;
  const changed = label.trim() !== link.label || description.trim() !== link.description;

  async function send(path: string, body: Record<string, unknown>, message: string) {
    const edits = await request.send(path, body, reason);
    if (edits) onSaved(edits, message);
  }
  const base = `/admin/links/${encodeURIComponent(link.id)}`;
  return (
    <div className="admin-link-editor">
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      <label className="community-field">
        <span>Relationship</span>
        <input value={label} maxLength={160} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <label className="community-field">
        <span>Description</span>
        <textarea
          rows={3}
          maxLength={4000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <ReasonField value={reason} onChange={setReason} />
      <div className="admin-form-actions">
        <button
          className="community-primary"
          disabled={busy || !changed}
          onClick={() =>
            void send(
              base,
              { patch: { label: label.trim(), description: description.trim() } },
              'Saved the connection.',
            )
          }
        >
          {busy && <LoaderCircle size={16} className="community-spinner" />} Save connection
        </button>
        <button
          className="community-text-button admin-danger"
          disabled={busy}
          onClick={() => {
            if (!hasReason(reason)) {
              setError('Say briefly why you are removing this connection.');
              return;
            }
            if (
              window.confirm(
                'Remove this connection? The place stays on the map for anyone else connected to it. You can undo this from the change history.',
              )
            )
              void send(`${base}/remove`, {}, 'Removed the connection.');
          }}
        >
          Remove connection
        </button>
      </div>
    </div>
  );
}

function NewLink({
  person,
  archive,
  burial,
  onCancel,
  onSaved,
}: {
  person: Person;
  archive: ArchiveData;
  /** Buried in a grave already on the map, such as a family crypt or lot, not a place in Atlanta. */
  burial: boolean;
  onCancel: () => void;
  onSaved: (edits: StaffEdit[]) => void;
}) {
  const linked = new Set(
    archive.relations.filter((item) => item.personId === person.id).map((item) => item.placeId),
  );
  // A grave is offered only to share it with someone buried there, never as a place in a life.
  const options = archive.places
    .filter((place) => !linked.has(place.id) && isGrave(place) === burial)
    .map((place) => ({ id: place.id, label: burial ? graveChoice(archive, place) : place.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const cited = personSourceIds(person, archive);
  const sources = archive.sources.filter((source) => cited.has(source.id));
  const [placeId, setPlaceId] = useState('');
  const [label, setLabel] = useState(burial ? 'Buried here' : '');
  const [description, setDescription] = useState('');
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const { busy, error, setError, send } = useStaffRequest();

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!placeId || !label.trim() || !sourceId) {
      setError(
        `Choose a ${burial ? 'grave' : 'place'}, describe the relationship and choose a source.`,
      );
      return;
    }
    const edits = await send(
      '/admin/links',
      {
        personId: person.id,
        placeId,
        label: label.trim(),
        description: description.trim(),
        sourceId,
        burial,
      },
      reason,
      { failure: 'The connection could not be saved.' },
    );
    if (edits) onSaved(edits);
  }

  return (
    <form className="admin-link-editor" onSubmit={save}>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      <label className="community-field">
        <span>{burial ? 'Grave *' : 'Place *'}</span>
        <select value={placeId} onChange={(event) => setPlaceId(event.target.value)}>
          <option value="">
            {burial ? 'Choose a grave already on the map' : 'Choose a place already on the map'}
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <small>
          {burial
            ? 'For a family crypt or lot already on the map, shared with someone buried there.'
            : 'Graves are not listed here. Each person’s grave is in the Grave section above.'}
        </small>
      </label>
      <label className="community-field">
        <span>Relationship *</span>
        <input
          value={label}
          maxLength={160}
          placeholder={burial ? 'For example: Buried here' : 'For example: Pastor 1931–1975'}
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <label className="community-field">
        <span>Description</span>
        <textarea
          rows={3}
          maxLength={4000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <label className="community-field">
        <span>Source *</span>
        <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
          {!sources.length && <option value="">This person’s record cites no sources yet</option>}
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.title}
            </option>
          ))}
        </select>
        <small>Every connection on the public page cites a source this record already uses.</small>
      </label>
      <ReasonField value={reason} onChange={setReason} />
      <div className="admin-form-actions">
        <button className="community-primary" disabled={busy}>
          {busy && <LoaderCircle size={16} className="community-spinner" />} Connect
        </button>
        <button type="button" className="community-text-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Year, then an optional month and day, for a birth or a death. */
function LifeDateFields({
  life,
  fields,
  edit,
}: {
  life: 'birth' | 'death';
  fields: Fields;
  edit: (key: keyof Fields, value: string) => void;
}) {
  const label = life === 'birth' ? 'Born' : 'Died';
  const month = fields[`${life}Month`];
  const year = Number(fields[`${life}Year`]) || undefined;
  const date = lifeDate(fields, life);
  return (
    <fieldset className="admin-fieldset">
      <legend>{label}</legend>
      <div className="admin-date-row">
        <label className="community-field">
          <span>Year</span>
          <input
            inputMode="numeric"
            maxLength={4}
            placeholder="Unknown"
            value={fields[`${life}Year`]}
            onChange={(event) => edit(`${life}Year`, event.target.value)}
          />
        </label>
        <label className="community-field">
          <span>Month</span>
          <select
            value={month}
            onChange={(event) => {
              edit(`${life}Month`, event.target.value);
              if (!event.target.value) edit(`${life}Day`, '');
            }}
          >
            <option value="">Not known</option>
            {months.map((value) => (
              <option key={value} value={String(value)}>
                {monthName(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="community-field">
          <span>Day</span>
          <input
            inputMode="numeric"
            maxLength={2}
            placeholder="—"
            disabled={!month}
            value={fields[`${life}Day`]}
            onChange={(event) => edit(`${life}Day`, event.target.value)}
          />
        </label>
      </div>
      <small>
        Shown on the person page as {formatLifeDate(year, date ?? undefined) ?? 'unknown'}. Lists
        and the map show the year only.
      </small>
    </fieldset>
  );
}
