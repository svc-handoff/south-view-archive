import Link from 'next/link';
import { ArrowLeft, BookOpen, CalendarDays, UserRound } from 'lucide-react';
import { formatEventDate, type ArchiveData, type ContributionEntry } from '@southview/validators';
import { CitationMarks, SourceList } from './citations';
import { PhotoViewer } from './photo-viewer';
import { withArchiveReturn } from '@/lib/archive-return';

const kindLabels = {
  memory: 'Community memory',
  addition: 'Community contribution',
  correction: 'Community correction',
  'new-person': 'Community introduction',
};

export function CommunityEntry({
  entry,
  archive,
  returnTo = '/explore',
}: {
  entry: ContributionEntry;
  archive: ArchiveData;
  returnTo?: string;
}) {
  const person = archive.people.find((person) => person.id === entry.personId);
  const relatedPeople = archive.people.filter((person) =>
    [entry.personId, ...entry.relatedPersonIds].includes(person.id),
  );
  const mentionedPlaces = archive.places.filter((place) => entry.placeIds.includes(place.id));
  const credit = archive.credits.find((credit) => credit.id === entry.creditId);
  const sources = archive.sources.filter(
    (source) => entry.sourceIds.includes(source.id) && source.url !== `/contributions/${entry.id}`,
  );
  const provider = credit?.displayName ?? 'Community contributor';
  const path = `/contributions/${encodeURIComponent(entry.id)}`;
  let permanentUrl = path;
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000');
    if (['https:', 'http:'].includes(origin.protocol))
      permanentUrl = new URL(path, origin.origin).href;
  } catch {
    /* Relative permalink remains usable. */
  }
  return (
    <article>
      <Link className="community-text-button" href={returnTo}>
        <ArrowLeft size={17} aria-hidden="true" /> Back to the map
      </Link>
      <header className="community-entry-header">
        <p className="community-preview-label">{kindLabels[entry.kind]}</p>
        <h1>{entry.title}</h1>
        <div className="community-byline">
          <span>
            <UserRound size={15} aria-hidden="true" /> Provider: {provider} — {entry.title}
          </span>
          <span>
            <CalendarDays size={15} aria-hidden="true" /> Published {entry.publishedAt.slice(0, 10)}
          </span>
        </div>
        <div className="photo-linked-metadata">
          <div>
            <strong>People in this contribution</strong>
            {relatedPeople.map((related) => (
              <Link
                key={related.id}
                href={withArchiveReturn(`/people/${encodeURIComponent(related.id)}`, returnTo)}
              >
                {related.name}
              </Link>
            ))}
          </div>
          <div>
            <strong>Event date</strong>
            <span>{formatEventDate(entry.eventDate)}</span>
          </div>
          {mentionedPlaces.length > 0 && (
            <div>
              <strong>Places mentioned</strong>
              <span>{mentionedPlaces.map((place) => place.name).join(' · ')}</span>
            </div>
          )}
        </div>
      </header>
      <div className="community-entry-note">
        <BookOpen size={18} aria-hidden="true" />{' '}
        {entry.kind === 'memory'
          ? 'A community member’s personal account, shared in its original context and reviewed for publication. It is presented as a memory.'
          : 'A contribution from the community, reviewed by archive reviewers and kept with its contributor credit and supporting context.'}
      </div>
      <div className="community-body">
        {entry.body}{' '}
        <CitationMarks
          citations={sources.map((source) => ({ sourceId: source.id }))}
          sources={archive.sources}
        />
      </div>
      {entry.context && (
        <section className="community-section" style={{ marginTop: 35 }}>
          <h2>The context behind this contribution</h2>
          <p className="community-body" style={{ marginTop: 18 }}>
            {entry.context}
          </p>
        </section>
      )}
      {(entry.sourceCreator || entry.narrator || entry.holdingInstitution) && (
        <dl className="community-fields">
          {entry.sourceCreator && (
            <div className="community-review-line">
              <dt>Original author or creator</dt>
              <dd>{entry.sourceCreator}</dd>
            </div>
          )}
          {entry.narrator && (
            <div className="community-review-line">
              <dt>Narrator</dt>
              <dd>{entry.narrator}</dd>
            </div>
          )}
          {entry.holdingInstitution && (
            <div className="community-review-line">
              <dt>Holding institution or collection</dt>
              <dd>{entry.holdingInstitution}</dd>
            </div>
          )}
        </dl>
      )}
      {entry.photos.length > 0 && (
        <PhotoViewer
          label={`Photographs from ${entry.title}`}
          items={entry.photos.map((photo) => ({
            id: photo.id,
            src: photo.url,
            alt: photo.caption,
            caption: photo.caption,
            creator: photo.creator,
            provider:
              archive.credits.find((credit) => credit.id === photo.creditId)?.displayName ??
              provider,
            rights: photo.rights,
            width: photo.width,
            height: photo.height,
            entry: {
              href: withArchiveReturn(`${path}#photo-${encodeURIComponent(photo.id)}`, returnTo),
              label: 'View original contribution',
            },
          }))}
        />
      )}
      {entry.publicNote && (
        <div className="community-entry-note">
          <strong>Editorial note</strong>
          <p>{entry.publicNote}</p>
        </div>
      )}
      {sources.length > 0 && (
        <section className="community-section">
          <h2>Related sources</h2>
          <SourceList sources={sources} allSources={archive.sources} credits={archive.credits} />
        </section>
      )}
      <section className="community-section">
        <h2>Cite this contribution</h2>
        <p className="community-body" style={{ marginTop: 16 }}>
          {provider} — {entry.title}. South-View community archive. Published{' '}
          {entry.publishedAt.slice(0, 10)}.
        </p>
        <a
          className="community-text-button"
          style={{ overflowWrap: 'anywhere' }}
          href={permanentUrl}
        >
          {permanentUrl}
        </a>
      </section>
      <div className="community-actions">
        <Link className="community-secondary" href={returnTo}>
          <ArrowLeft size={17} aria-hidden="true" /> Back to the map
        </Link>
        {person && (
          <Link
            className="community-secondary"
            href={withArchiveReturn(`/people/${encodeURIComponent(person.id)}`, returnTo)}
          >
            <ArrowLeft size={17} aria-hidden="true" /> Back to {person.name}’s record
          </Link>
        )}
      </div>
    </article>
  );
}
