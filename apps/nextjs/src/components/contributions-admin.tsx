'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, LoaderCircle, MessageSquareQuote } from 'lucide-react';
import type {
  ArchiveData,
  ContributionEntry,
  EventDate,
  Person,
  StaffEdit,
} from '@southview/validators';
import { displayPersonName } from '@/lib/person-name';
import { CommunityNotice } from './community-shell';
import { Checklist, ReasonField, savedMessage, useStaffRequest } from './admin-shared';
import { EventDateFields, eventDateProblem } from './event-date-fields';

type Saved = (edits: StaffEdit[], message: string) => void;
type Photo = ContributionEntry['photos'][number];

/** Published contributions about this person, each correctable in place. */
export function PersonContributions({
  person,
  archive,
  initialEntryId,
  onSaved,
}: {
  person: Person;
  archive: ArchiveData;
  initialEntryId?: string | null;
  onSaved: Saved;
}) {
  const entries = archive.contributions
    .filter((entry) => entry.personId === person.id)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const [open, setOpen] = useState<string | null>(
    initialEntryId && entries.some((entry) => entry.id === initialEntryId) ? initialEntryId : null,
  );
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (initialEntryId && open === initialEntryId)
      section.current?.scrollIntoView({ block: 'start' });
    // Only on arrival from the Contributions tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const credit = (entry: ContributionEntry) =>
    archive.credits.find((item) => item.id === entry.creditId)?.displayName ?? 'A contributor';
  return (
    <section className="admin-section" aria-labelledby="admin-contributions-heading" ref={section}>
      <h3 id="admin-contributions-heading">
        <MessageSquareQuote size={18} aria-hidden="true" /> Published contributions
      </h3>
      <p className="admin-history-note">
        Correct the public text of a contribution without withdrawing it. To take one down, withdraw
        it on the Contributions tab.
      </p>
      {!entries.length && (
        <p className="admin-history-note">No contributions are published on this page.</p>
      )}
      <ul className="admin-links">
        {entries.map((entry) => (
          <li key={entry.id}>
            <div className="admin-link-summary">
              <div>
                <strong>{entry.title}</strong>
                <span>
                  {credit(entry)} · published{' '}
                  {new Date(entry.publishedAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}
                  {entry.featured ? ' · featured' : ''}
                </span>
              </div>
              <div className="admin-link-actions">
                <button
                  className="community-text-button"
                  aria-expanded={open === entry.id}
                  onClick={() => setOpen(open === entry.id ? null : entry.id)}
                >
                  {open === entry.id ? 'Close' : 'Edit'}
                </button>
              </div>
            </div>
            {open === entry.id && (
              <ContributionForm
                entry={entry}
                person={person}
                archive={archive}
                onCancel={() => setOpen(null)}
                onSaved={(edits, message) => {
                  setOpen(null);
                  onSaved(edits, message);
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContributionForm({
  entry,
  person,
  archive,
  onCancel,
  onSaved,
}: {
  entry: ContributionEntry;
  person: Person;
  archive: ArchiveData;
  onCancel: () => void;
  onSaved: Saved;
}) {
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const [context, setContext] = useState(entry.context);
  const [sourceCreator, setSourceCreator] = useState(entry.sourceCreator);
  const [narrator, setNarrator] = useState(entry.narrator);
  const [holdingInstitution, setHoldingInstitution] = useState(entry.holdingInstitution);
  const [publicNote, setPublicNote] = useState(entry.publicNote ?? '');
  const [featured, setFeatured] = useState(entry.featured);
  const [eventDate, setEventDate] = useState<EventDate>(entry.eventDate);
  const [relatedPersonIds, setRelatedPersonIds] = useState(entry.relatedPersonIds);
  const [placeIds, setPlaceIds] = useState(entry.placeIds);
  const [photos, setPhotos] = useState<Photo[]>(entry.photos);
  const [reason, setReason] = useState('');
  const { busy, error, setError, send } = useStaffRequest();
  const people = archive.people
    .filter((item) => item.id !== person.id)
    .sort((a, b) => a.name.localeCompare(b.name));
  const places = [...archive.places].sort((a, b) => a.name.localeCompare(b.name));
  const portraitUrls = new Set(
    archive.people.flatMap((item) => (item.portrait ? [item.portrait.url] : [])),
  );

  function setPhoto(id: string, field: 'caption' | 'creator' | 'rights', value: string) {
    setPhotos((current) =>
      current.map((photo) => (photo.id === id ? { ...photo, [field]: value } : photo)),
    );
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const problem = eventDateProblem(eventDate);
    if (problem) {
      setError(problem);
      return;
    }
    const patch: Record<string, unknown> = {};
    const text = {
      title,
      body,
      context,
      sourceCreator,
      narrator,
      holdingInstitution,
      publicNote,
    } as const;
    for (const [field, value] of Object.entries(text)) {
      const saved =
        field === 'publicNote' ? (entry.publicNote ?? '') : entry[field as keyof typeof text];
      if (value.trim() !== saved) patch[field] = value.trim();
    }
    if (featured !== entry.featured) patch.featured = featured;
    if (JSON.stringify(eventDate) !== JSON.stringify(entry.eventDate)) patch.eventDate = eventDate;
    if (JSON.stringify(relatedPersonIds) !== JSON.stringify(entry.relatedPersonIds))
      patch.relatedPersonIds = relatedPersonIds;
    if (JSON.stringify(placeIds) !== JSON.stringify(entry.placeIds)) patch.placeIds = placeIds;
    const photoEdits = photos
      .filter((photo) => {
        const before = entry.photos.find((item) => item.id === photo.id)!;
        return (['caption', 'creator', 'rights'] as const).some(
          (field) => photo[field].trim() !== before[field],
        );
      })
      .map((photo) => ({
        id: photo.id,
        caption: photo.caption.trim(),
        creator: photo.creator.trim(),
        rights: photo.rights.trim(),
      }));
    if (photoEdits.length) patch.photos = photoEdits;
    if (!Object.keys(patch).length) {
      setError('Nothing has changed yet.');
      return;
    }
    const edits = await send(
      `/admin/contributions/${encodeURIComponent(entry.id)}`,
      { patch },
      reason,
      {
        missingReason: 'Say briefly why you are correcting this contribution.',
        failure: 'The contribution could not be saved.',
      },
    );
    if (edits) onSaved(edits, savedMessage(edits, 'Saved the contribution. It is live.'));
  }

  return (
    <form className="admin-link-editor" onSubmit={save}>
      <p>
        <Link
          className="community-text-button"
          href={`/contributions/${encodeURIComponent(entry.id)}`}
          target="_blank"
        >
          Open the published entry <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </p>
      {error && <CommunityNotice kind="error">{error}</CommunityNotice>}
      <label className="community-field">
        <span>Public title *</span>
        <input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="community-field">
        <span>Public text *</span>
        <textarea
          rows={Math.min(14, Math.max(5, Math.ceil(body.length / 90)))}
          maxLength={20000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label className="community-field">
        <span>Context</span>
        <textarea
          rows={2}
          maxLength={4000}
          value={context}
          onChange={(e) => setContext(e.target.value)}
        />
      </label>
      <div className="community-two-columns">
        <label className="community-field">
          <span>Created by</span>
          <input
            value={sourceCreator}
            maxLength={200}
            placeholder="Blank shows the contributor’s credit"
            onChange={(e) => setSourceCreator(e.target.value)}
          />
        </label>
        <label className="community-field">
          <span>Narrator</span>
          <input value={narrator} maxLength={200} onChange={(e) => setNarrator(e.target.value)} />
        </label>
      </div>
      <label className="community-field">
        <span>Held by</span>
        <input
          value={holdingInstitution}
          maxLength={200}
          placeholder="Library or archive holding the original, if any"
          onChange={(e) => setHoldingInstitution(e.target.value)}
        />
      </label>
      <fieldset className="admin-fieldset">
        <legend>When it happened</legend>
        <EventDateFields wording="staff" value={eventDate} onChange={setEventDate} />
      </fieldset>
      {photos.length > 0 && (
        <fieldset className="admin-fieldset">
          <legend>Photographs</legend>
          {photos.map((photo) => (
            <div className="admin-photo" key={photo.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="" width={96} height={96} />
              <div className="community-fields">
                {portraitUrls.has(photo.url) && (
                  <small className="admin-history-note">
                    Also the portrait on a person page; corrections apply there too.
                  </small>
                )}
                <label className="community-field">
                  <span>Caption *</span>
                  <input
                    value={photo.caption}
                    maxLength={500}
                    onChange={(e) => setPhoto(photo.id, 'caption', e.target.value)}
                  />
                </label>
                <div className="community-two-columns">
                  <label className="community-field">
                    <span>Creator *</span>
                    <input
                      value={photo.creator}
                      maxLength={160}
                      onChange={(e) => setPhoto(photo.id, 'creator', e.target.value)}
                    />
                  </label>
                  <label className="community-field">
                    <span>Rights *</span>
                    <input
                      value={photo.rights}
                      maxLength={1000}
                      onChange={(e) => setPhoto(photo.id, 'rights', e.target.value)}
                    />
                  </label>
                </div>
              </div>
            </div>
          ))}
        </fieldset>
      )}
      <Checklist
        legend="Other people it concerns"
        items={people}
        selected={relatedPersonIds}
        onChange={setRelatedPersonIds}
        label={(other) => displayPersonName(other.name)}
      />
      <Checklist
        legend="Places it mentions"
        items={places}
        selected={placeIds}
        onChange={setPlaceIds}
        label={(place) => place.name}
      />
      <label className="community-field">
        <span>Public note</span>
        <textarea
          rows={2}
          maxLength={3000}
          value={publicNote}
          placeholder="Optional editor’s note shown with the contribution"
          onChange={(e) => setPublicNote(e.target.value)}
        />
      </label>
      <label className="community-check">
        <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
        <span>Feature this contribution</span>
      </label>
      <ReasonField value={reason} onChange={setReason} />
      <div className="admin-form-actions">
        <button className="community-primary" disabled={busy}>
          {busy && <LoaderCircle size={16} className="community-spinner" />} Save contribution
        </button>
        <button type="button" className="community-text-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
