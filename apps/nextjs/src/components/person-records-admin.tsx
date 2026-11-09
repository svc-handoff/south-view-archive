'use client';
import { useState, type FormEvent } from 'react';
import { BookOpen, FileWarning, Headphones, LoaderCircle, Plus } from 'lucide-react';
import type {
  ArchiveData,
  EventDate,
  Material,
  Person,
  Source,
  StaffEdit,
} from '@southview/validators';
import { displayPersonName } from '@/lib/person-name';
import { CommunityNotice } from './community-shell';
import {
  Checklist,
  ReasonField,
  hasReason,
  personSourceIds,
  savedMessage,
  useStaffRequest,
} from './admin-shared';
import { EventDateFields, eventDateProblem } from './event-date-fields';

type Issue = ArchiveData['issues'][number];
type Saved = (edits: StaffEdit[], message: string) => void;
const byTitle = (a: Source, b: Source) => a.title.localeCompare(b.title);

/** How many records cite a source, so staff know a correction to its link applies to them all. */
function sourceUses(sourceId: string, archive: ArchiveData) {
  const cited = (citations: { sourceId: string }[]) =>
    citations.filter((item) => item.sourceId === sourceId).length;
  return (
    archive.people.reduce(
      (sum, person) =>
        sum +
        cited(person.summaryCitations) +
        person.biography.reduce((total, block) => total + cited(block.citations), 0) +
        (person.portrait?.sourceId === sourceId ? 1 : 0),
      0,
    ) +
    archive.places.reduce(
      (sum, place) => sum + cited(place.summaryCitations) + cited(place.coordinateCitations),
      0,
    ) +
    archive.relations.reduce((sum, relation) => sum + cited(relation.citations), 0) +
    archive.materials.filter((item) => item.sourceId === sourceId).length +
    archive.issues.filter((item) => item.sourceIds.includes(sourceId)).length +
    archive.contributions.filter((item) => item.sourceIds.includes(sourceId)).length
  );
}

// ——— Records and oral histories ———

export function PersonMaterials({
  person,
  archive,
  onSaved,
}: {
  person: Person;
  archive: ArchiveData;
  onSaved: Saved;
}) {
  const materials = archive.materials.filter((item) => item.personId === person.id);
  const elsewhere = archive.materials.filter((item) => item.relatedPersonIds.includes(person.id));
  const [open, setOpen] = useState<string | null>(null);
  const done: Saved = (edits, message) => {
    setOpen(null);
    onSaved(edits, message);
  };
  return (
    <section className="admin-section" aria-labelledby="admin-materials-heading">
      <h3 id="admin-materials-heading">
        <Headphones size={18} aria-hidden="true" /> Records &amp; oral histories
      </h3>
      <p className="admin-history-note">
        Each one links to the library, archive or website that holds the recording or document.
        Files are not uploaded here.
      </p>
      {!materials.length && <p className="admin-history-note">None yet.</p>}
      <ul className="admin-links">
        {materials.map((material) => {
          const Icon = material.kind === 'oral-history' ? Headphones : BookOpen;
          return (
            <li key={material.id}>
              <div className="admin-link-summary">
                <div>
                  <strong>
                    <Icon size={15} aria-hidden="true" /> {material.title}
                  </strong>
                  <span>
                    {material.kind === 'oral-history' ? 'Oral history' : 'Document'}
                    {' · '}
                    {archive.sources.find((source) => source.id === material.sourceId)?.publisher ??
                      'Unknown collection'}
                  </span>
                </div>
                <div className="admin-link-actions">
                  <button
                    className="community-text-button"
                    aria-expanded={open === material.id}
                    onClick={() => setOpen(open === material.id ? null : material.id)}
                  >
                    {open === material.id ? 'Close' : 'Edit'}
                  </button>
                </div>
              </div>
              {open === material.id && (
                <MaterialForm
                  person={person}
                  archive={archive}
                  material={material}
                  onCancel={() => setOpen(null)}
                  onSaved={done}
                />
              )}
            </li>
          );
        })}
      </ul>
      {elsewhere.length > 0 && (
        <p className="admin-history-note">
          Also shown on this page, edited from the main person’s record:{' '}
          {elsewhere
            .map((item) => {
              const owner = archive.people.find((other) => other.id === item.personId);
              return `${item.title} (${owner ? displayPersonName(owner.name) : 'another person'})`;
            })
            .join('; ')}
          .
        </p>
      )}
      {open === 'new' ? (
        <MaterialForm
          person={person}
          archive={archive}
          onCancel={() => setOpen(null)}
          onSaved={done}
        />
      ) : (
        <button className="community-secondary" onClick={() => setOpen('new')}>
          <Plus size={16} aria-hidden="true" /> Add a record or oral history
        </button>
      )}
    </section>
  );
}

type LinkFields = {
  title: string;
  creator: string;
  publisher: string;
  url: string;
  rights: string;
};
const emptyLink: LinkFields = { title: '', creator: '', publisher: '', url: '', rights: '' };
const linkFor = (source: Source | undefined): LinkFields =>
  source
    ? {
        title: source.title,
        creator: source.creator,
        publisher: source.publisher,
        url: source.url,
        rights: source.rights ?? '',
      }
    : emptyLink;
const trimLink = (link: LinkFields): LinkFields => ({
  title: link.title.trim(),
  creator: link.creator.trim(),
  publisher: link.publisher.trim(),
  url: link.url.trim(),
  rights: link.rights.trim(),
});
const sameLink = (a: LinkFields, b: LinkFields) =>
  JSON.stringify(trimLink(a)) === JSON.stringify(trimLink(b));

function MaterialForm({
  person,
  archive,
  material,
  onCancel,
  onSaved,
}: {
  person: Person;
  archive: ArchiveData;
  material?: Material;
  onCancel: () => void;
  onSaved: Saved;
}) {
  const own = personSourceIds(person, archive);
  const sources = [...archive.sources].sort(byTitle);
  const suggested = sources.filter((source) => own.has(source.id));
  const others = sources.filter((source) => !own.has(source.id));
  const [kind, setKind] = useState<Material['kind']>(material?.kind ?? 'oral-history');
  const [title, setTitle] = useState(material?.title ?? '');
  const [description, setDescription] = useState(material?.description ?? '');
  const [narrator, setNarrator] = useState(material?.narrator ?? '');
  const [interviewer, setInterviewer] = useState(material?.interviewer ?? '');
  const [date, setDate] = useState(material?.date ?? '');
  const [eventDate, setEventDate] = useState<EventDate>(material?.eventDate ?? { kind: 'unknown' });
  const [placeIds, setPlaceIds] = useState(material?.placeIds ?? []);
  const [relatedPersonIds, setRelatedPersonIds] = useState(material?.relatedPersonIds ?? []);
  const [mode, setMode] = useState<'new' | 'existing'>(material ? 'existing' : 'new');
  const [sourceId, setSourceId] = useState(material?.sourceId ?? suggested[0]?.id ?? '');
  const chosen = archive.sources.find((source) => source.id === sourceId);
  const [link, setLink] = useState<LinkFields>(material ? linkFor(chosen) : emptyLink);
  const [reason, setReason] = useState('');
  const { busy, error, setError, send } = useStaffRequest();
  const linkedPlaceIds = new Set(
    archive.relations.filter((item) => item.personId === person.id).map((item) => item.placeId),
  );
  const places = [...archive.places].sort(
    (a, b) =>
      Number(linkedPlaceIds.has(b.id)) - Number(linkedPlaceIds.has(a.id)) ||
      a.name.localeCompare(b.name),
  );
  const people = archive.people
    .filter((item) => item.id !== person.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const contributionSource = mode === 'existing' && chosen?.kind === 'community-contribution';
  const uses = chosen
    ? sourceUses(chosen.id, archive) - (material?.sourceId === chosen.id ? 1 : 0)
    : 0;

  function chooseSource(id: string) {
    setSourceId(id);
    setLink(linkFor(archive.sources.find((source) => source.id === id)));
  }
  function setLinkField(field: keyof LinkFields, value: string) {
    setLink((current) => ({ ...current, [field]: value }));
  }
  async function save(formEvent: FormEvent) {
    formEvent.preventDefault();
    const problem = eventDateProblem(eventDate);
    if (problem) {
      setError(problem);
      return;
    }
    if (mode === 'existing' && !sourceId) {
      setError('Choose the source, or paste a new link.');
      return;
    }
    const source =
      mode === 'new'
        ? { mode, link: trimLink(link) }
        : {
            mode,
            sourceId,
            ...(!contributionSource && !sameLink(link, linkFor(chosen))
              ? { link: trimLink(link) }
              : {}),
          };
    const edits = await send(
      material ? `/admin/materials/${encodeURIComponent(material.id)}` : '/admin/materials',
      {
        ...(material ? {} : { personId: person.id }),
        material: {
          kind,
          title: title.trim(),
          description: description.trim(),
          narrator: narrator.trim(),
          interviewer: interviewer.trim(),
          date: date.trim(),
          eventDate,
          placeIds,
          relatedPersonIds,
        },
        source,
      },
      reason,
    );
    if (edits)
      onSaved(
        edits,
        savedMessage(
          edits,
          material ? 'Saved the record.' : 'Added. It now appears on this person’s page.',
        ),
      );
  }

  return (
    <form className="admin-link-editor" onSubmit={save}>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      <div className="community-two-columns">
        <label className="community-field">
          <span>Type</span>
          <select
            value={kind}
            onChange={(change) => setKind(change.target.value as Material['kind'])}
          >
            <option value="oral-history">Oral history</option>
            <option value="document">Document or record</option>
          </select>
        </label>
        <label className="community-field">
          <span>Recorded or written</span>
          <input
            value={date}
            maxLength={200}
            placeholder="For example: 1973-06-28"
            onChange={(change) => setDate(change.target.value)}
          />
        </label>
      </div>
      <label className="community-field">
        <span>Title *</span>
        <input value={title} maxLength={300} onChange={(change) => setTitle(change.target.value)} />
      </label>
      <label className="community-field">
        <span>Description *</span>
        <textarea
          rows={3}
          maxLength={4000}
          value={description}
          placeholder="What it covers, and what a visitor will find at the collection"
          onChange={(change) => setDescription(change.target.value)}
        />
      </label>
      {kind === 'oral-history' && (
        <div className="community-two-columns">
          <label className="community-field">
            <span>Narrator</span>
            <input
              value={narrator}
              maxLength={200}
              onChange={(change) => setNarrator(change.target.value)}
            />
          </label>
          <label className="community-field">
            <span>Interviewer</span>
            <input
              value={interviewer}
              maxLength={200}
              onChange={(change) => setInterviewer(change.target.value)}
            />
          </label>
        </div>
      )}
      <fieldset className="admin-fieldset">
        <legend>When the events it describes happened</legend>
        <EventDateFields wording="staff" value={eventDate} onChange={setEventDate} />
      </fieldset>

      <fieldset className="admin-fieldset">
        <legend>Where it is held *</legend>
        <div className="admin-radio-row">
          <label className="community-check">
            <input
              type="radio"
              name="source-mode"
              checked={mode === 'new'}
              onChange={() => {
                setMode('new');
                setLink(emptyLink);
              }}
            />
            <span>Paste a new link</span>
          </label>
          <label className="community-check">
            <input
              type="radio"
              name="source-mode"
              checked={mode === 'existing'}
              onChange={() => {
                setMode('existing');
                chooseSource(sourceId || suggested[0]?.id || others[0]?.id || '');
              }}
            />
            <span>Use a source already in the archive</span>
          </label>
        </div>
        {mode === 'existing' && (
          <label className="community-field">
            <span>Source</span>
            <select value={sourceId} onChange={(change) => chooseSource(change.target.value)}>
              <option value="">Choose a source</option>
              {suggested.length > 0 && (
                <optgroup label="Already cited on this page">
                  {suggested.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.title} — {source.publisher}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="Other sources">
                {others.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.title} — {source.publisher}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        )}
        {contributionSource ? (
          <p className="admin-history-note">
            This is a contribution’s own source, so its link cannot be changed here.
          </p>
        ) : (
          (mode === 'new' || chosen) && (
            <>
              {mode === 'existing' && uses > 0 && (
                <p className="admin-history-note">
                  {uses === 1
                    ? 'One other part of the archive also cites this source.'
                    : `${uses} other parts of the archive also cite this source.`}{' '}
                  A correction to its link applies there too.
                </p>
              )}
              <label className="community-field">
                <span>Web address *</span>
                <input
                  type="url"
                  value={link.url}
                  maxLength={2000}
                  placeholder="https://"
                  onChange={(change) => setLinkField('url', change.target.value)}
                />
              </label>
              <div className="community-two-columns">
                <label className="community-field">
                  <span>Held by *</span>
                  <input
                    value={link.publisher}
                    maxLength={200}
                    placeholder="Library, archive or website"
                    onChange={(change) => setLinkField('publisher', change.target.value)}
                  />
                </label>
                <label className="community-field">
                  <span>Creator</span>
                  <input
                    value={link.creator}
                    maxLength={200}
                    placeholder="Person or office that made it"
                    onChange={(change) => setLinkField('creator', change.target.value)}
                  />
                </label>
              </div>
              <label className="community-field">
                <span>Title at the collection</span>
                <input
                  value={link.title}
                  maxLength={300}
                  placeholder="Leave blank to use the title above"
                  onChange={(change) => setLinkField('title', change.target.value)}
                />
              </label>
              <label className="community-field">
                <span>Rights</span>
                <input
                  value={link.rights}
                  maxLength={500}
                  placeholder="As the collection states it, if it does"
                  onChange={(change) => setLinkField('rights', change.target.value)}
                />
              </label>
            </>
          )
        )}
      </fieldset>

      <Checklist
        legend="Related places"
        items={places}
        selected={placeIds}
        onChange={setPlaceIds}
        label={(place) => (
          <>
            {place.name}
            {linkedPlaceIds.has(place.id) && <small>Connected to this person</small>}
          </>
        )}
      />
      <Checklist
        legend="Other people it concerns"
        items={people}
        selected={relatedPersonIds}
        onChange={setRelatedPersonIds}
        label={(other) => displayPersonName(other.name)}
      />
      <small className="admin-history-note">
        It also appears on the pages of the other people chosen here.
      </small>

      <ReasonField value={reason} onChange={setReason} />
      <div className="admin-form-actions">
        <button className="community-primary" disabled={busy}>
          {busy && <LoaderCircle size={16} className="community-spinner" />}
          {material ? 'Save record' : 'Add to this page'}
        </button>
        {material && (
          <button
            type="button"
            className="community-text-button admin-danger"
            disabled={busy}
            onClick={() => {
              if (!hasReason(reason)) {
                setError('Say briefly why you are removing this record.');
                return;
              }
              if (
                window.confirm(
                  'Remove this record from the page? The collection link stays in the archive’s sources. You can undo this from the change history.',
                )
              )
                void send(
                  `/admin/materials/${encodeURIComponent(material.id)}/remove`,
                  {},
                  reason,
                ).then((edits) => edits && onSaved(edits, 'Removed the record.'));
            }}
          >
            Remove record
          </button>
        )}
        <button type="button" className="community-text-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ——— Notes on the record ———

const concerns: Record<string, string> = {
  name: 'Name',
  birthYear: 'Birth date',
  deathYear: 'Death date',
  burialCoordinates: 'Burial location',
  places: 'Places',
  oralHistoryAccess: 'Oral history access',
  other: 'Something else',
};

export function PersonNotes({
  person,
  archive,
  onSaved,
}: {
  person: Person;
  archive: ArchiveData;
  onSaved: Saved;
}) {
  const issues = archive.issues.filter((item) => item.personId === person.id && item.id);
  const [open, setOpen] = useState<string | null>(null);
  const done: Saved = (edits, message) => {
    setOpen(null);
    onSaved(edits, message);
  };
  return (
    <section className="admin-section" aria-labelledby="admin-notes-heading">
      <h3 id="admin-notes-heading">
        <FileWarning size={18} aria-hidden="true" /> Notes on this record
      </h3>
      <p className="admin-history-note">
        Shown on the public page under “A note on this record”, for example where sources disagree
        about a date or a location is uncertain.
      </p>
      {!issues.length && <p className="admin-history-note">No notes.</p>}
      <ul className="admin-links">
        {issues.map((issue) => (
          <li key={issue.id}>
            <div className="admin-link-summary">
              <div>
                <strong>{concerns[issue.field] ?? issue.field}</strong>
                <span>{issue.note}</span>
              </div>
              <div className="admin-link-actions">
                <button
                  className="community-text-button"
                  aria-expanded={open === issue.id}
                  onClick={() => setOpen(open === issue.id ? null : issue.id!)}
                >
                  {open === issue.id ? 'Close' : 'Edit'}
                </button>
              </div>
            </div>
            {open === issue.id && (
              <IssueForm
                person={person}
                archive={archive}
                issue={issue}
                onCancel={() => setOpen(null)}
                onSaved={done}
              />
            )}
          </li>
        ))}
      </ul>
      {open === 'new' ? (
        <IssueForm
          person={person}
          archive={archive}
          onCancel={() => setOpen(null)}
          onSaved={done}
        />
      ) : (
        <button className="community-secondary" onClick={() => setOpen('new')}>
          <Plus size={16} aria-hidden="true" /> Add a note
        </button>
      )}
    </section>
  );
}

function IssueForm({
  person,
  archive,
  issue,
  onCancel,
  onSaved,
}: {
  person: Person;
  archive: ArchiveData;
  issue?: Issue;
  onCancel: () => void;
  onSaved: Saved;
}) {
  const own = personSourceIds(person, archive);
  const [field, setField] = useState(issue?.field ?? 'birthYear');
  const [note, setNote] = useState(issue?.note ?? '');
  const [sourceIds, setSourceIds] = useState(issue?.sourceIds ?? []);
  const [allSources, setAllSources] = useState(false);
  const [reason, setReason] = useState('');
  const { busy, error, setError, send } = useStaffRequest();
  const sources = [...archive.sources]
    .filter((source) => allSources || own.has(source.id) || sourceIds.includes(source.id))
    .sort(byTitle);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (note.trim().length < 10) {
      setError('Write the note in at least 10 characters.');
      return;
    }
    const edits = await send(
      issue?.id ? `/admin/issues/${encodeURIComponent(issue.id)}` : '/admin/issues',
      { ...(issue ? {} : { personId: person.id }), field, note: note.trim(), sourceIds },
      reason,
    );
    if (edits)
      onSaved(
        edits,
        savedMessage(
          edits,
          issue ? 'Saved the note.' : 'Added. The note now appears on this person’s page.',
        ),
      );
  }

  return (
    <form className="admin-link-editor" onSubmit={save}>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      <label className="community-field">
        <span>Concerns</span>
        <select value={field} onChange={(event) => setField(event.target.value)}>
          {Object.entries(concerns).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          {!concerns[field] && <option value={field}>{field}</option>}
        </select>
        <small>For staff only. The public page shows just the note.</small>
      </label>
      <label className="community-field">
        <span>Note *</span>
        <textarea
          rows={4}
          maxLength={4000}
          value={note}
          placeholder="For example: The death certificate gives 1899; the census gives 1897. The year is not shown until this is settled."
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <Checklist
        legend="Sources the note cites"
        items={sources}
        selected={sourceIds}
        onChange={setSourceIds}
        label={(source) => (
          <>
            {source.title}
            <small>{source.publisher}</small>
          </>
        )}
      />
      <label className="community-check">
        <input
          type="checkbox"
          checked={allSources}
          onChange={(event) => setAllSources(event.target.checked)}
        />
        <span>List every source in the archive, not just those this page cites</span>
      </label>
      <ReasonField value={reason} onChange={setReason} />
      <div className="admin-form-actions">
        <button className="community-primary" disabled={busy}>
          {busy && <LoaderCircle size={16} className="community-spinner" />}
          {issue ? 'Save note' : 'Add note'}
        </button>
        {issue?.id && (
          <button
            type="button"
            className="community-text-button admin-danger"
            disabled={busy}
            onClick={() => {
              if (!hasReason(reason)) {
                setError('Say briefly why you are removing this note.');
                return;
              }
              if (window.confirm('Remove this note? You can undo this from the change history.'))
                void send(`/admin/issues/${encodeURIComponent(issue.id!)}/remove`, {}, reason).then(
                  (edits) => edits && onSaved(edits, 'Removed the note.'),
                );
            }}
          >
            Remove note
          </button>
        )}
        <button type="button" className="community-text-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
