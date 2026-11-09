'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, LoaderCircle, MapPin, Search } from 'lucide-react';
import type { ArchiveData, Place, StaffEdit, StaffPlaceEdit } from '@southview/validators';
import { displayPersonName } from '@/lib/person-name';
import { precisionLabels } from '@/lib/place-mode';
import { CommunityNotice } from './community-shell';
import { DeleteRecord, RecentlyDeleted } from './admin-delete';
import { ReasonField, savedMessage, useStaffRequest } from './admin-shared';
import { ChangeHistory, fieldLabels, useStaffHistory } from './admin-history';
import { LocationPicker } from './location-picker';

type Fields = {
  name: string;
  scope: Place['scope'];
  address: string;
  coordinates: [number, number] | null;
  precision: Place['precision'];
  locationNote: string;
  summary: string;
};
const fieldsFor = (place: Place): Fields => ({
  name: place.name,
  scope: place.scope,
  address: place.address ?? '',
  coordinates: place.coordinates,
  precision: place.precision,
  locationNote: place.locationNote,
  summary: place.summary,
});
function patchFor(fields: Fields, saved: Fields): StaffPlaceEdit['patch'] {
  const patch: StaffPlaceEdit['patch'] = {};
  if (fields.name.trim() !== saved.name) patch.name = fields.name.trim();
  if (fields.scope !== saved.scope) patch.scope = fields.scope;
  if (fields.address.trim() !== saved.address) patch.address = fields.address.trim() || null;
  if (JSON.stringify(fields.coordinates) !== JSON.stringify(saved.coordinates))
    patch.coordinates = fields.coordinates;
  if (fields.precision !== saved.precision) patch.precision = fields.precision;
  if (fields.locationNote.trim() !== saved.locationNote)
    patch.locationNote = fields.locationNote.trim();
  if (fields.summary.trim() !== saved.summary) patch.summary = fields.summary.trim();
  return patch;
}
const scopeLabels = { cemetery: 'South-View Cemetery', atlanta: 'Atlanta' } as const;

export function PlacesAdmin({
  archive,
  initialPlaceId,
  onPlaceChange,
  onOpenPerson,
  onSaved,
  onDirtyChange,
  confirmLeave,
}: {
  archive: ArchiveData;
  initialPlaceId: string | null;
  onPlaceChange: (placeId: string | null) => void;
  onOpenPerson: (personId: string) => void;
  onSaved: (edits: StaffEdit[]) => void;
  onDirtyChange: (dirty: boolean) => void;
  confirmLeave: () => boolean;
}) {
  const places = [...archive.places].sort((a, b) => a.name.localeCompare(b.name));
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPlaceId && places.some((place) => place.id === initialPlaceId) ? initialPlaceId : null,
  );
  const [mobileDetail, setMobileDetail] = useState(!!selectedId);
  const [deletedNotice, setDeletedNotice] = useState('');
  const [deletedVersion, setDeletedVersion] = useState(0);
  const visible = places.filter((place) =>
    `${place.name} ${place.address ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const selected = places.find((place) => place.id === selectedId) ?? null;
  const count = (placeId: string) =>
    archive.relations.filter((relation) => relation.placeId === placeId).length;

  function choose(placeId: string) {
    if (placeId === selectedId) {
      setMobileDetail(true);
      return;
    }
    if (!confirmLeave()) return;
    onDirtyChange(false);
    setSelectedId(placeId);
    setMobileDetail(true);
    onPlaceChange(placeId);
  }

  return (
    <div className="review-workspace admin-people" data-mobile-detail={mobileDetail}>
      <aside className="review-queue" aria-label="Places on the map">
        <div className="review-queue-tools">
          <div className="review-section-heading">
            <h2>
              <MapPin size={19} aria-hidden="true" /> Places
            </h2>
            <span aria-live="polite">{visible.length}</span>
          </div>
          <label className="review-search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Search place names or addresses</span>
            <input
              type="search"
              placeholder="Place name or address"
              value={q}
              maxLength={200}
              onChange={(event) => setQ(event.target.value)}
            />
          </label>
        </div>
        <div className="review-queue-list">
          {visible.map((place) => (
            <button
              className="review-queue-item"
              key={place.id}
              aria-pressed={place.id === selectedId}
              onClick={() => choose(place.id)}
            >
              <strong>{place.name}</strong>
              <span className="review-byline">
                {scopeLabels[place.scope]} · {precisionLabels[place.precision]}
              </span>
              <span className="review-row-meta">
                {count(place.id)} {count(place.id) === 1 ? 'person' : 'people'} connected
              </span>
            </button>
          ))}
          {!visible.length && (
            <div className="review-empty">
              <MapPin size={28} aria-hidden="true" />
              <h3>No matching places</h3>
              <button className="community-text-button" onClick={() => setQ('')}>
                Clear search
              </button>
            </div>
          )}
        </div>
        <RecentlyDeleted
          kind="place"
          version={deletedVersion}
          onRestored={(edits, placeId) => {
            onSaved(edits);
            setDeletedNotice('');
            setSelectedId(placeId);
            setMobileDetail(true);
            onPlaceChange(placeId);
          }}
        />
      </aside>
      <div className="review-detail-scroll">
        <button
          className="review-mobile-back community-text-button"
          onClick={() => setMobileDetail(false)}
        >
          <ArrowLeft size={17} /> Back to places
        </button>
        {selected ? (
          <PlaceEditor
            key={selected.id}
            place={selected}
            archive={archive}
            onDirtyChange={onDirtyChange}
            onSaved={onSaved}
            onDeleted={(edits) => {
              onDirtyChange(false);
              onSaved(edits);
              setSelectedId(null);
              setMobileDetail(false);
              onPlaceChange(null);
              setDeletedNotice(`Deleted ${selected.name}.`);
              setDeletedVersion((value) => value + 1);
            }}
            onOpenPerson={(personId) => {
              if (confirmLeave()) {
                onDirtyChange(false);
                onOpenPerson(personId);
              }
            }}
          />
        ) : (
          <div className="review-empty admin-empty">
            <MapPin size={28} aria-hidden="true" />
            {deletedNotice && <CommunityNotice kind="success">{deletedNotice}</CommunityNotice>}
            <h3>Choose a place</h3>
            <p>Correct a place’s name, map position, precision, location note or description.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PlaceEditor({
  place,
  archive,
  onDirtyChange,
  onSaved,
  onDeleted,
  onOpenPerson,
}: {
  place: Place;
  archive: ArchiveData;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (edits: StaffEdit[]) => void;
  onDeleted: (edits: StaffEdit[]) => void;
  onOpenPerson: (personId: string) => void;
}) {
  const [savedFields, setSavedFields] = useState(() => fieldsFor(place));
  const [fields, setFields] = useState(savedFields);
  const [reason, setReason] = useState('');
  const { busy, error, setError, send } = useStaffRequest();
  const [notice, setNotice] = useState('');
  const history = useStaffHistory(`/admin/places/${encodeURIComponent(place.id)}`);
  const patch = patchFor(fields, savedFields);
  const changed = Object.keys(patch);
  const people = archive.relations
    .filter((relation) => relation.placeId === place.id)
    .map((relation) => ({
      relation,
      person: archive.people.find((person) => person.id === relation.personId),
    }));

  useEffect(() => {
    onDirtyChange(changed.length > 0 || !!reason.trim());
  }, [changed.length, reason, onDirtyChange]);

  function edit<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((current) => ({ ...current, [key]: value }));
    setNotice('');
  }
  function saved(edits: StaffEdit[], message: string) {
    const record = edits.find((item) => item.targetTable === 'places')?.next as Place | undefined;
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
    if (!fields.name.trim() || !fields.locationNote.trim()) {
      setError('A place needs a name and a location note.');
      return;
    }
    const edits = await send(`/admin/places/${encodeURIComponent(place.id)}`, { patch }, reason, {
      missingReason:
        'Say briefly why you are making this change. It is shown in the change history.',
    });
    if (edits)
      saved(
        edits,
        savedMessage(edits, 'Saved. The map and every connected person’s page show the change.'),
      );
  }

  return (
    <section className="review-editor" aria-label={`Edit ${place.name}`}>
      <header className="review-detail-heading">
        <span className="theme-label">Map place</span>
        <h2>{place.name}</h2>
        <p>
          {scopeLabels[place.scope]} · {precisionLabels[place.precision]}
        </p>
      </header>
      <div className="review-detail-content">
        {notice && <CommunityNotice kind="success">{notice}</CommunityNotice>}
        {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
        <form className="admin-form" onSubmit={save}>
          <div className="community-fields">
            <label className="community-field">
              <span>Name</span>
              <input
                value={fields.name}
                maxLength={160}
                onChange={(event) => edit('name', event.target.value)}
              />
            </label>
            <label className="community-field">
              <span>Address</span>
              <input
                value={fields.address}
                maxLength={300}
                placeholder="Street address, if there is one"
                onChange={(event) => edit('address', event.target.value)}
              />
            </label>
            <LocationPicker
              label="Map position"
              hint="Drag the pin, tap the map, search an address or type coordinates. Clear the pin for a place that is not yet mapped."
              value={
                fields.coordinates ? { coordinates: fields.coordinates, scope: fields.scope } : null
              }
              onChange={(picked) => {
                setFields((current) => ({
                  ...current,
                  coordinates: picked?.coordinates ?? null,
                  scope: picked?.scope ?? current.scope,
                  precision: picked
                    ? current.precision === 'unmapped'
                      ? 'address'
                      : current.precision
                    : 'unmapped',
                }));
                setNotice('');
              }}
            />
            <div className="community-two-columns">
              <label className="community-field">
                <span>Precision</span>
                <select
                  value={fields.precision}
                  onChange={(event) => edit('precision', event.target.value as Place['precision'])}
                >
                  {(Object.keys(precisionLabels) as Place['precision'][]).map((value) => (
                    <option
                      key={value}
                      value={value}
                      disabled={(value === 'unmapped') !== !fields.coordinates}
                    >
                      {precisionLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="community-field">
                <span>Area</span>
                <select
                  value={fields.scope}
                  onChange={(event) => edit('scope', event.target.value as Place['scope'])}
                >
                  <option value="cemetery">{scopeLabels.cemetery}</option>
                  <option value="atlanta">{scopeLabels.atlanta}</option>
                </select>
              </label>
            </div>
            <label className="community-field">
              <span>Location note</span>
              <textarea
                rows={3}
                maxLength={2000}
                value={fields.locationNote}
                onChange={(event) => edit('locationNote', event.target.value)}
              />
              <small>How the position is known, and how far to trust it. Shown publicly.</small>
            </label>
            <label className="community-field">
              <span>Description of the place</span>
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
              placeholder="For example: position checked on site"
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
        <section className="admin-section" aria-labelledby="admin-place-people">
          <h3 id="admin-place-people">People connected to this place</h3>
          {!people.length && <p className="admin-history-note">No one is connected yet.</p>}
          <ul className="admin-links">
            {people.map(({ relation, person }) => (
              <li key={relation.id}>
                <div className="admin-link-summary">
                  <div>
                    <strong>{person ? displayPersonName(person.name) : 'Unknown person'}</strong>
                    <span>{relation.label}</span>
                  </div>
                  {person && (
                    <div className="admin-link-actions">
                      <button
                        className="community-text-button"
                        onClick={() => onOpenPerson(person.id)}
                      >
                        Edit on the People tab
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <ChangeHistory
          history={history.history}
          error={history.error}
          archive={archive}
          note="Direct corrections to this place and to everyone’s connections to it."
          onUndone={(edits) =>
            saved(edits, 'Undone. The place is back as it was, apart from later changes.')
          }
        />
        <DeleteRecord kind="place" id={place.id} name={place.name} onDeleted={onDeleted} />
      </div>
    </section>
  );
}
