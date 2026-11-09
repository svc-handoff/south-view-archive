import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, BookOpen, ExternalLink, Headphones, MapPin } from 'lucide-react';
import {
  formatEventDate,
  formatLifeDate,
  portraitRights,
  publicRelatedPersonIds,
  type ArchiveData,
  type EventDate,
  type Person,
  type Place,
} from '@southview/validators';
import { CitationMarks, SourceList } from './citations';
import { ProvidedBy } from './provided-by';
import { SiteNavigation } from './site-navigation';
import { PhotoViewer } from './photo-viewer';
import { withArchiveReturn } from '@/lib/archive-return';
import { displayPersonName } from '@/lib/person-name';
import { copy } from '@/lib/copy';
import { PersonEditProvider } from './person-edit/context';
import { AddSlot } from './person-edit/slot';
import { EditEntryButton, EditToolbar } from './person-edit/toolbar';

/** "1897–1984", or "December 19, 1897 – November 11, 1984" when full dates are known. */
function lifeSpan(person: Person) {
  const born = formatLifeDate(person.birthYear, person.birthDate);
  const died = formatLifeDate(person.deathYear, person.deathDate);
  if (!born) return `Died ${died}`;
  if (!died) return person.birthDate ? `Born ${born}` : born;
  return person.birthDate || person.deathDate ? `${born} – ${died}` : `${born}–${died}`;
}

const precisionLabels: Record<Place['precision'], string> = {
  reference: 'Reference position · unverified',
  address: 'Approximate address position',
  verified: 'Verified position',
  unmapped: 'Not yet mapped',
};

function RecordContext({
  record,
  data,
  returnTo,
}: {
  record: {
    personId: string;
    relatedPersonIds: string[];
    placeIds: string[];
    eventDate: EventDate;
  };
  data: ArchiveData;
  returnTo: string;
}) {
  const personIds = publicRelatedPersonIds(record);
  const people = data.people.filter((person) => personIds.includes(person.id));
  const mentionedPlaces = data.places.filter((place) => record.placeIds.includes(place.id));
  return (
    <div className="photo-linked-metadata">
      <div>
        <strong>People</strong>
        {people.map((person) => (
          <Link
            key={person.id}
            href={withArchiveReturn(`/people/${encodeURIComponent(person.id)}`, returnTo)}
          >
            {person.name}
          </Link>
        ))}
      </div>
      <div>
        <strong>Event date</strong>
        <span>{formatEventDate(record.eventDate)}</span>
      </div>
      {mentionedPlaces.length > 0 && (
        <div>
          <strong>Places mentioned</strong>
          <span>{mentionedPlaces.map((place) => place.name).join(' · ')}</span>
        </div>
      )}
    </div>
  );
}

export function PersonArchive({
  person,
  data,
  returnTo,
  canonicalUrl,
  startEditing = false,
}: {
  person: Person;
  data: ArchiveData;
  returnTo: string;
  canonicalUrl: string;
  startEditing?: boolean;
}) {
  const relations = data.relations.filter((relation) => relation.personId === person.id);
  const materials = data.materials.filter((material) =>
    publicRelatedPersonIds(material).includes(person.id),
  );
  const contributions = data.contributions.filter((entry) =>
    publicRelatedPersonIds(entry).includes(person.id),
  );
  const portraitSource = data.sources.find((source) => source.id === person.portrait?.sourceId);
  const contributorIds = new Set([
    ...person.creditIds,
    ...person.biography.flatMap((block) => block.creditIds),
    ...relations.flatMap((relation) => relation.creditIds),
    ...materials.flatMap((material) => material.creditIds),
    ...contributions.map((entry) => entry.creditId),
    ...contributions.flatMap((entry) => entry.photos.map((photo) => photo.creditId)),
    ...(person.portrait?.creditIds ?? []),
  ]);
  const issues = data.issues.filter((issue) => issue.personId === person.id);
  const places = data.places.filter((place) =>
    relations.some((relation) => relation.placeId === place.id),
  );
  const citations = [
    ...person.summaryCitations,
    ...person.biography.flatMap((block) => block.citations),
    ...relations.flatMap((relation) => relation.citations),
    ...places.flatMap((place) => [...place.summaryCitations, ...place.coordinateCitations]),
  ];
  const usedSourceIds = new Set([
    ...citations.map((citation) => citation.sourceId),
    ...materials.map((material) => material.sourceId),
    ...contributions.flatMap((entry) => entry.sourceIds),
    ...issues.flatMap((issue) => issue.sourceIds),
    ...(person.portrait ? [person.portrait.sourceId] : []),
  ]);
  const sources = data.sources.filter((source) => usedSourceIds.has(source.id));

  return (
    <div className="archive-page">
      <SiteNavigation personId={person.id} />

      <PersonEditProvider
        person={{ id: person.id, name: displayPersonName(person.name) }}
        places={data.places.map(({ id, name, scope }) => ({ id, name, scope }))}
        startEditing={startEditing}
      >
        <main id="main-content">
          <div className="archive-topbar">
            <Link className="archive-back" href={returnTo}>
              <ArrowLeft size={18} aria-hidden="true" /> Back to the map
            </Link>
            <span className="archive-topbar-tools">
              <EditEntryButton />
              <a className="archive-permalink" href={canonicalUrl}>
                <ExternalLink size={16} aria-hidden="true" /> Permanent link
              </a>
            </span>
          </div>
          <EditToolbar />

          <div className="archive-layout">
            <article className="archive-main">
              <header className="archive-person-heading">
                <p className="archive-eyebrow">Lives remembered · Person record</p>
                <h1 className="archive-title">{displayPersonName(person.name)}</h1>
                {(person.birthYear || person.deathYear) && (
                  <p className="archive-years">
                    {lifeSpan(person)}{' '}
                    <CitationMarks citations={person.summaryCitations} sources={data.sources} />
                  </p>
                )}
                {!!person.occupations?.length && (
                  <div className="archive-tags archive-occupations" aria-label="Occupations">
                    {person.occupations.map((occupation) => (
                      <Link
                        className="archive-tag archive-tag-occupation"
                        key={occupation}
                        href={`/explore?q=${encodeURIComponent(occupation)}`}
                        title={`Find others in the archive: ${occupation}`}
                      >
                        {occupation}
                      </Link>
                    ))}
                  </div>
                )}
                <div className="archive-tags" aria-label="Themes">
                  {person.themes.map((theme) => (
                    <Link
                      className="archive-tag"
                      key={theme}
                      href={`/explore?theme=${encodeURIComponent(theme)}`}
                    >
                      {theme}
                    </Link>
                  ))}
                </div>
                <p className="archive-summary">
                  {person.summary}{' '}
                  <CitationMarks citations={person.summaryCitations} sources={data.sources} />
                </p>
                <ProvidedBy
                  creditIds={person.creditIds}
                  title={`${person.name}: overview`}
                  data={data}
                  returnTo={returnTo}
                />
              </header>

              {person.portrait && (
                <PhotoViewer
                  variant="portrait"
                  label={`Portrait of ${person.name}`}
                  items={[
                    {
                      id: 'portrait',
                      src: person.portrait.url,
                      alt: person.portrait.alt,
                      caption: `${person.name}: portrait`,
                      creator: portraitSource?.creator || person.portrait.credit,
                      provider:
                        person.portrait.creditIds
                          .map((id) => data.credits.find((credit) => credit.id === id)?.displayName)
                          .filter(Boolean)
                          .join(', ') || 'Initial archive compilation',
                      rights:
                        portraitRights(person, data) ||
                        'No rights statement is recorded here. Consult the original source.',
                      source: portraitSource
                        ? { href: portraitSource.url, label: 'View original image source' }
                        : undefined,
                    },
                  ]}
                />
              )}

              {!person.portrait && <AddSlot section="portrait" />}

              {person.biography.length > 0 && (
                <section className="archive-section" aria-labelledby="story-heading">
                  <p className="archive-eyebrow">Their story</p>
                  <h2 id="story-heading">A life in context</h2>
                  <div className="archive-prose">
                    {person.biography.map((block, index) => (
                      <div key={block.id ?? index}>
                        <p>
                          {block.text}{' '}
                          <CitationMarks citations={block.citations} sources={data.sources} />
                        </p>
                        <ProvidedBy
                          creditIds={block.creditIds}
                          title={`Biographical account ${index + 1}`}
                          data={data}
                          returnTo={returnTo}
                        />
                        <AddSlot
                          section="biography"
                          anchor={block.id ?? String(index)}
                          original={block.text}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {person.biography.length === 0 && (
                <AddSlot section="biography" anchor="start" addLabel="Start their story" />
              )}

              <section className="archive-section" aria-labelledby="places-heading">
                <p className="archive-eyebrow">Across the neighborhood</p>
                <h2 id="places-heading">Places connected to this life</h2>
                {relations.length === 0 && (
                  <p className="archive-empty">
                    No place relationship has been documented in this edition of the archive.
                  </p>
                )}
                {relations.map((relation) => {
                  const place = places.find((item) => item.id === relation.placeId);
                  if (!place) return null;
                  const mapUrl = `/explore?scope=${place.scope}&person=${encodeURIComponent(person.id)}&place=${encodeURIComponent(place.id)}${place.coordinates ? `&lng=${place.coordinates[0]}&lat=${place.coordinates[1]}&z=${place.scope === 'cemetery' ? '17' : '15'}` : ''}`;
                  return (
                    <div className="archive-place" key={relation.id}>
                      <div className="archive-place-title">
                        <MapPin size={21} aria-hidden="true" />
                        <h3>{place.name}</h3>
                      </div>
                      <p className="archive-eyebrow">
                        {place.scope === 'cemetery' ? 'South-View Cemetery' : 'Atlanta'} ·{' '}
                        {relation.label}
                      </p>
                      {place.summary && (
                        <p className="archive-place-summary">
                          {place.summary}{' '}
                          <CitationMarks
                            citations={place.summaryCitations}
                            sources={data.sources}
                          />
                        </p>
                      )}
                      <p>
                        {relation.description}{' '}
                        <CitationMarks citations={relation.citations} sources={data.sources} />
                      </p>
                      {place.address && <p className="archive-place-address">{place.address}</p>}
                      <ProvidedBy
                        creditIds={relation.creditIds}
                        title={`${place.name}: connection`}
                        data={data}
                        returnTo={returnTo}
                      />
                      <div className="archive-location-note">
                        <span className={`precision-badge precision-${place.precision}`}>
                          {precisionLabels[place.precision]}
                        </span>
                        <p>
                          {place.locationNote}{' '}
                          <CitationMarks
                            citations={place.coordinateCitations}
                            sources={data.sources}
                          />
                        </p>
                      </div>
                      <ProvidedBy
                        creditIds={place.creditIds}
                        title={`${place.name}: location`}
                        data={data}
                        returnTo={returnTo}
                      />
                      <div className="archive-place-links">
                        <Link
                          className="archive-text-link"
                          href={withArchiveReturn(
                            `/places/${encodeURIComponent(place.id)}?person=${encodeURIComponent(person.id)}`,
                            returnTo,
                          )}
                        >
                          About this place <ArrowUpRight size={17} aria-hidden="true" />
                        </Link>
                        {place.coordinates && (
                          <Link className="archive-text-link" href={mapUrl}>
                            Explore on the map <ArrowUpRight size={17} aria-hidden="true" />
                          </Link>
                        )}
                      </div>
                      {!place.coordinates && (
                        <p className="archive-unmapped">
                          This relationship is documented; a map position is not yet available.
                        </p>
                      )}
                      <AddSlot
                        section="places"
                        anchor={relation.id}
                        place={{
                          relationId: relation.id,
                          placeId: place.id,
                          name: place.name,
                          description: relation.description,
                          summary: place.summary,
                          coordinates: place.coordinates,
                          scope: place.scope,
                        }}
                      />
                    </div>
                  );
                })}
                <AddSlot section="places" />
              </section>

              <section className="archive-section" aria-labelledby="materials-heading">
                <p className="archive-eyebrow">From the collections</p>
                <h2 id="materials-heading">Records &amp; oral histories</h2>
                {materials.length === 0 && (
                  <p className="archive-empty">
                    No media or collection links have been added to this record yet.
                  </p>
                )}
                {materials.map((material) => {
                  const source = sources.find((item) => item.id === material.sourceId);
                  if (!source) return null;
                  const Icon = material.kind === 'oral-history' ? Headphones : BookOpen;
                  return (
                    <div
                      className="archive-material"
                      key={material.id}
                      id={`material-${material.id}`}
                    >
                      <Icon aria-hidden="true" size={25} />
                      <div>
                        <p className="archive-eyebrow">
                          {material.kind === 'oral-history'
                            ? 'Oral history · External collection'
                            : 'Document · External collection'}
                        </p>
                        <h3>{material.title}</h3>
                        <ProvidedBy
                          creditIds={material.creditIds}
                          title={material.title}
                          data={data}
                          returnTo={returnTo}
                        />
                        <p>
                          {material.description}{' '}
                          <CitationMarks
                            citations={[{ sourceId: source.id }]}
                            sources={data.sources}
                          />
                        </p>
                        <RecordContext record={material} data={data} returnTo={returnTo} />
                        <dl className="archive-material-meta">
                          {material.narrator && (
                            <div>
                              <dt>Narrator</dt>
                              <dd>{material.narrator}</dd>
                            </div>
                          )}
                          {material.interviewer && (
                            <div>
                              <dt>Interviewer</dt>
                              <dd>{material.interviewer}</dd>
                            </div>
                          )}
                          {material.date && (
                            <div>
                              <dt>Recorded</dt>
                              <dd>{material.date}</dd>
                            </div>
                          )}
                        </dl>
                        <a
                          className="archive-text-link"
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Visit the collection <ExternalLink size={16} aria-hidden="true" />
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      </div>
                    </div>
                  );
                })}
              </section>

              {issues.length > 0 && (
                <section className="archive-editorial-note" aria-labelledby="editorial-heading">
                  <h2 id="editorial-heading">A note on this record</h2>
                  {issues.map((issue, index) => (
                    <p key={`${issue.field}-${index}`}>
                      {issue.note}{' '}
                      <CitationMarks
                        citations={issue.sourceIds.map((sourceId) => ({ sourceId }))}
                        sources={data.sources}
                      />
                    </p>
                  ))}
                </section>
              )}

              <section className="archive-section" aria-labelledby="community-heading">
                <p className="archive-eyebrow">In the community’s words</p>
                <h2 id="community-heading">Contributions &amp; memories</h2>
                <p>
                  Each contribution keeps its own voice and credit. Community memories are personal
                  accounts; review does not turn them into verified historical facts.
                </p>
                {contributions.map((entry) => (
                  <article className="photo-related-entry" key={entry.id}>
                    <p className="archive-eyebrow">
                      {entry.kind === 'memory' ? 'Community memory' : 'Community contribution'}
                    </p>
                    <h3>
                      <Link
                        href={withArchiveReturn(
                          `/contributions/${encodeURIComponent(entry.id)}`,
                          returnTo,
                        )}
                      >
                        {entry.title}
                      </Link>
                    </h3>
                    <ProvidedBy
                      creditIds={[entry.creditId]}
                      title={entry.title}
                      data={data}
                      returnTo={returnTo}
                    />
                    <RecordContext record={entry} data={data} returnTo={returnTo} />
                    <p>
                      {entry.body.slice(0, 240)}
                      {entry.body.length > 240 ? '…' : ''}
                    </p>
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
                            data.credits.find((credit) => credit.id === photo.creditId)
                              ?.displayName ??
                            data.credits.find((credit) => credit.id === entry.creditId)
                              ?.displayName ??
                            'Community contributor',
                          rights: photo.rights,
                          width: photo.width,
                          height: photo.height,
                          entry: {
                            href: withArchiveReturn(
                              `/contributions/${encodeURIComponent(entry.id)}#photo-${encodeURIComponent(photo.id)}`,
                              returnTo,
                            ),
                            label: 'View original contribution',
                          },
                        }))}
                      />
                    )}
                    <Link
                      className="archive-text-link"
                      href={withArchiveReturn(
                        `/contributions/${encodeURIComponent(entry.id)}`,
                        returnTo,
                      )}
                    >
                      Read contribution <ArrowUpRight size={17} />
                    </Link>
                  </article>
                ))}
                {!contributions.length && (
                  <p className="archive-empty">
                    No community contributions have been published for this person yet.
                  </p>
                )}
                <AddSlot section="community" />
                <EditEntryButton
                  variant="button"
                  label={copy.shareAbout(displayPersonName(person.name))}
                />
              </section>

              <section
                className="archive-section archive-sources"
                id="sources"
                aria-labelledby="sources-heading"
              >
                <p className="archive-eyebrow">Follow the evidence</p>
                <h2 id="sources-heading">Sources &amp; further reading</h2>
                <p>
                  Numbered references connect each account and location to its source. Original
                  collections open in a new tab.
                </p>
                <SourceList
                  sources={sources}
                  allSources={data.sources}
                  citations={citations}
                  credits={data.credits}
                />
              </section>
            </article>

            <aside className="archive-aside" aria-label="Record navigation">
              <div className="archive-aside-card">
                <p className="archive-eyebrow">On this page</p>
                <nav aria-label="Within this record">
                  {person.biography.length > 0 && <a href="#story-heading">Their story</a>}
                  <a href="#places-heading">
                    Connected places <span>{relations.length}</span>
                  </a>
                  <a href="#materials-heading">
                    Records &amp; oral histories <span>{materials.length}</span>
                  </a>
                  <a href="#sources">
                    Sources <span>{sources.length}</span>
                  </a>
                  <a href="#community-heading">
                    Community contributions <span>{contributions.length}</span>
                  </a>
                </nav>
                <Link className="archive-button" href={returnTo}>
                  <MapPin size={18} aria-hidden="true" /> Explore the map
                </Link>
              </div>
              <div className="archive-aside-card archive-contributors">
                <p className="archive-eyebrow">Know something about this life?</p>
                <EditEntryButton variant="button" label={copy.editPage} />
                <p className="archive-aside-help">
                  Add a memory, a photograph, a place, or a correction right where it belongs.
                  Reviewers approve it before it is public.
                </p>
                <p className="archive-aside-credits">
                  Compiled by{' '}
                  {[...contributorIds]
                    .map((id) => data.credits.find((credit) => credit.id === id)?.displayName)
                    .filter(Boolean)
                    .join(', ')}
                </p>
              </div>
            </aside>
          </div>
        </main>
      </PersonEditProvider>

      <footer className="archive-footer">
        <span>South-View · History in the Neighborhood</span>
      </footer>
    </div>
  );
}
