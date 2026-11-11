'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Flower2, LoaderCircle, MapPin, Search } from 'lucide-react';
import {
  graveOccupants,
  graveTitle,
  isGrave,
  type ArchiveData,
  type Person,
  type Place,
  type StaffEdit,
  type StaffPlaceEdit,
} from '@southview/validators';
import { displayPersonName } from '@/lib/person-name';
import { precisionLabels } from '@/lib/place-mode';
import { CommunityNotice } from './community-shell';
import { DeleteRecord, RecentlyDeleted } from './admin-delete';
import { ReasonField, savedMessage, useStaffRequest } from './admin-shared';
import { ChangeHistory, fieldLabels, useStaffHistory } from './admin-history';
import { LocationPicker, scopeFor } from './location-picker';

/** Which tab: graves at South-View, or places from their lives in Atlanta. */
type Kind = 'graves' | 'places';
/** What the editor corrects. The area is not among them: a grave stays a grave, a place a place. */
type Fields = {
  name: string;
  address: string;
  coordinates: [number, number] | null;
  precision: Place['precision'];
  locationNote: string;
  summary: string;
};
const fieldsFor = (place: Place): Fields => ({
  name: place.name,
  address: place.address ?? '',
  coordinates: place.coordinates,
  precision: place.precision,
  locationNote: place.locationNote,
  summary: place.summary,
});
function patchFor(fields: Fields, saved: Fields): StaffPlaceEdit['patch'] {
  const patch: StaffPlaceEdit['patch'] = {};
  if (fields.name.trim() !== saved.name) patch.name = fields.name.trim();
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
/** Whether two names read the same, whatever the spacing (such as the fixed space before Sr.). */
const sameName = (a: string, b: string) =>
  a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/** The people buried in a grave, in the order they were connected to it. */
const buriedIn = (archive: ArchiveData, placeId: string): Person[] =>
  graveOccupants(archive, placeId).flatMap((id) =>
    archive.people.filter((person) => person.id === id),
  );

/** One row of the list, with what the editor heading and the search need. */
type Row = {
  place: Place;
  /** A grave is named by the people buried there; a place by its own name. */
  title: string;
  byline: string;
  meta: string;
  /** The meta line says why a grave needs attention. */
  alert: boolean;
  needsChecking: boolean;
  search: string;
};

function listRows(archive: ArchiveData, kind: Kind): Row[] {
  if (kind === 'places')
    return archive.places
      .filter((place) => !isGrave(place))
      .map((place) => {
        const count = archive.relations.filter((relation) => relation.placeId === place.id).length;
        return {
          place,
          title: place.name,
          byline: precisionLabels[place.precision],
          meta: `${count} ${count === 1 ? 'person' : 'people'} connected`,
          alert: false,
          needsChecking: false,
          search: `${place.name} ${place.address ?? ''}`.toLowerCase(),
        };
      });
  const graves = archive.places.filter(isGrave);
  // Graves at exactly the same point still share one placeholder position.
  const atPoint = new Map<string, number>();
  for (const place of graves)
    if (place.coordinates) {
      const point = place.coordinates.join(',');
      atPoint.set(point, (atPoint.get(point) ?? 0) + 1);
    }
  return graves.map((place) => {
    const people = buriedIn(archive, place.id);
    const title = people.length
      ? graveTitle(people.map((person) => displayPersonName(person.name)))
      : place.name;
    const unmapped = !place.coordinates || place.precision === 'unmapped';
    const sharing = place.coordinates ? (atPoint.get(place.coordinates.join(',')) ?? 1) - 1 : 0;
    const meta = unmapped
      ? 'Not yet mapped'
      : sharing
        ? `Same pin as ${sharing} other ${sharing === 1 ? 'grave' : 'graves'}`
        : '';
    return {
      place,
      title,
      byline: [sameName(place.name, title) ? '' : place.name, precisionLabels[place.precision]]
        .filter(Boolean)
        .join(' · '),
      meta,
      alert: !!meta,
      needsChecking: unmapped || place.precision !== 'verified' || sharing > 0,
      search: [place.name, ...people.flatMap((person) => [person.name, ...person.aliases])]
        .join(' ')
        .toLowerCase(),
    };
  });
}

export function PlacesAdmin({
  kind,
  archive,
  initialPlaceId,
  onPlaceChange,
  onOpenPerson,
  onOpenPlace,
  onSaved,
  onDirtyChange,
  confirmLeave,
}: {
  /** Graves lists only graves at South-View; Places only places in Atlanta. */
  kind: Kind;
  archive: ArchiveData;
  initialPlaceId: string | null;
  onPlaceChange: (placeId: string | null) => void;
  onOpenPerson: (personId: string) => void;
  /** Opens a place on whichever tab it belongs to. */
  onOpenPlace: (placeId: string) => void;
  onSaved: (edits: StaffEdit[]) => void;
  onDirtyChange: (dirty: boolean) => void;
  confirmLeave: () => boolean;
}) {
  const graves = kind === 'graves';
  const Icon = graves ? Flower2 : MapPin;
  const rows = listRows(archive, kind).sort((a, b) => a.title.localeCompare(b.title));
  const [q, setQ] = useState('');
  const [checking, setChecking] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPlaceId && rows.some((row) => row.place.id === initialPlaceId) ? initialPlaceId : null,
  );
  const [mobileDetail, setMobileDetail] = useState(!!selectedId);
  const [deletedNotice, setDeletedNotice] = useState('');
  const [deletedVersion, setDeletedVersion] = useState(0);
  // A restored place that belongs on the other tab. It opens there once the archive has it back,
  // so the other tab can tell from the archive where it belongs.
  const [restoredElsewhere, setRestoredElsewhere] = useState<string | null>(null);
  const query = q.trim().toLowerCase();
  const toCheck = rows.filter((row) => row.needsChecking).length;
  const visible = rows.filter(
    (row) => row.search.includes(query) && (!checking || row.needsChecking),
  );
  const selected = rows.find((row) => row.place.id === selectedId) ?? null;

  useEffect(() => {
    if (!restoredElsewhere || !archive.places.some((place) => place.id === restoredElsewhere))
      return;
    setRestoredElsewhere(null);
    if (!confirmLeave()) return;
    onDirtyChange(false);
    onOpenPlace(restoredElsewhere);
  }, [restoredElsewhere, archive.places, confirmLeave, onDirtyChange, onOpenPlace]);

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
      <aside
        className="review-queue"
        aria-label={graves ? 'Graves at South-View Cemetery' : 'Places in Atlanta'}
      >
        <div className="review-queue-tools">
          <div className="review-section-heading">
            <h2>
              <Icon size={19} aria-hidden="true" /> {graves ? 'Graves' : 'Places'}
            </h2>
            <span aria-live="polite">{visible.length}</span>
          </div>
          <label className="review-search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">
              {graves
                ? 'Search by the name of someone buried here, or the grave’s name'
                : 'Search place names or addresses'}
            </span>
            <input
              type="search"
              placeholder={graves ? 'Name of someone buried here' : 'Place name or address'}
              value={q}
              maxLength={200}
              onChange={(event) => setQ(event.target.value)}
            />
          </label>
          {graves && (
            <button
              type="button"
              className="admin-grave-filter"
              aria-pressed={checking}
              title="Graves not yet mapped, not verified, or on the same pin as another grave"
              onClick={() => setChecking((value) => !value)}
            >
              Needs checking ({toCheck})
            </button>
          )}
        </div>
        <div className="review-queue-list">
          {visible.map((row) => (
            <button
              className="review-queue-item"
              key={row.place.id}
              aria-pressed={row.place.id === selectedId}
              onClick={() => choose(row.place.id)}
            >
              <strong>{row.title}</strong>
              <span className="review-byline">{row.byline}</span>
              {row.meta && (
                <span
                  className={
                    row.alert ? 'review-row-meta admin-grave-attention' : 'review-row-meta'
                  }
                >
                  {row.meta}
                </span>
              )}
            </button>
          ))}
          {!visible.length && (
            <div className="review-empty">
              <Icon size={28} aria-hidden="true" />
              <h3>
                {!graves
                  ? 'No matching places'
                  : checking && !query
                    ? 'No graves need checking'
                    : 'No matching graves'}
              </h3>
              {query && (
                <button className="community-text-button" onClick={() => setQ('')}>
                  Clear search
                </button>
              )}
              {checking && (
                <button className="community-text-button" onClick={() => setChecking(false)}>
                  Show all graves
                </button>
              )}
            </div>
          )}
        </div>
        <RecentlyDeleted
          kind="place"
          version={deletedVersion}
          only={(previous) => isGrave({ scope: String(previous.scope) }) === graves}
          onRestored={(edits, placeId) => {
            onSaved(edits);
            setDeletedNotice('');
            const restored = edits.find(
              (edit) => edit.targetTable === 'places' && edit.targetId === placeId,
            )?.next as Place | undefined;
            if (restored && isGrave(restored) !== graves) {
              setRestoredElsewhere(placeId);
              return;
            }
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
          <ArrowLeft size={17} /> {graves ? 'Back to graves' : 'Back to places'}
        </button>
        {selected ? (
          <PlaceEditor
            key={selected.place.id}
            kind={kind}
            place={selected.place}
            title={selected.title}
            archive={archive}
            onDirtyChange={onDirtyChange}
            onSaved={onSaved}
            onDeleted={(edits) => {
              onDirtyChange(false);
              onSaved(edits);
              setSelectedId(null);
              setMobileDetail(false);
              onPlaceChange(null);
              setDeletedNotice(`Deleted ${selected.title}.`);
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
            <Icon size={28} aria-hidden="true" />
            {deletedNotice && <CommunityNotice kind="success">{deletedNotice}</CommunityNotice>}
            {graves ? (
              <>
                <h3>Choose a grave</h3>
                <p>
                  Correct where someone is buried: the map position, how sure it is, and the note
                  shown with it. A grave is added from the person’s record, or with Map burial here
                  at the grave.
                </p>
              </>
            ) : (
              <>
                <h3>Choose a place</h3>
                <p>
                  Correct a place from their lives in Atlanta: its name, address, map position,
                  precision, location note or description. Graves are on the Graves tab.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PlaceEditor({
  kind,
  place,
  title,
  archive,
  onDirtyChange,
  onSaved,
  onDeleted,
  onOpenPerson,
}: {
  kind: Kind;
  place: Place;
  /** The heading: for a grave, the people buried there. */
  title: string;
  archive: ArchiveData;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (edits: StaffEdit[]) => void;
  onDeleted: (edits: StaffEdit[]) => void;
  onOpenPerson: (personId: string) => void;
}) {
  const grave = kind === 'graves';
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
  // Which side of the cemetery outline the pin is on. Only a check: the place keeps its area.
  const pin = fields.coordinates
    ? { coordinates: fields.coordinates, scope: scopeFor(fields.coordinates) }
    : null;
  const otherSide = !!pin && pin.scope !== place.scope;

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
    <section className="review-editor" aria-label={`Edit ${title}`}>
      <header className="review-detail-heading">
        <span className="theme-label">{grave ? 'Grave' : 'Map place'}</span>
        <h2>{title}</h2>
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
              <span>{grave ? 'Name on the map' : 'Name'}</span>
              <input
                value={fields.name}
                maxLength={160}
                onChange={(event) => edit('name', event.target.value)}
              />
              {grave && (
                <small>
                  Shown on the map and on the person’s page, for example Grave of Duke Pearson, or
                  King family crypt.
                </small>
              )}
            </label>
            {(!grave || !!place.address) && (
              <label className="community-field">
                <span>Address</span>
                <input
                  value={fields.address}
                  maxLength={300}
                  placeholder="Street address, if there is one"
                  onChange={(event) => edit('address', event.target.value)}
                />
              </label>
            )}
            <LocationPicker
              label={grave ? 'Grave position' : 'Map position'}
              hint={
                grave
                  ? 'Drag the pin, tap the map or type coordinates. At the grave, use Map burial here on the person’s record to save a measured position.'
                  : 'Drag the pin, tap the map, search an address or type coordinates. Clear the pin for a place that is not yet mapped.'
              }
              value={pin}
              onChange={(picked) => {
                // The pin moves the position, never the area: what the place is stays as it is.
                setFields((current) => ({
                  ...current,
                  coordinates: picked?.coordinates ?? null,
                  precision: picked
                    ? current.precision === 'unmapped'
                      ? 'address'
                      : current.precision
                    : 'unmapped',
                }));
                setNotice('');
              }}
            />
            {otherSide && (
              <p className="admin-grave-pin-note" role="status">
                {grave
                  ? 'This pin is outside South-View Cemetery.'
                  : 'This pin is inside South-View Cemetery. It stays a place in Atlanta; graves are kept on the Graves tab.'}
              </p>
            )}
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
          <h3 id="admin-place-people">
            {grave ? 'Buried here' : 'People connected to this place'}
          </h3>
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
                        {grave ? 'Open on the People tab' : 'Edit on the People tab'}
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
        <DeleteRecord kind="place" id={place.id} name={title} onDeleted={onDeleted} />
      </div>
    </section>
  );
}
