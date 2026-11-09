import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, ExternalLink, MapPin, Navigation, Sprout } from 'lucide-react';
import type { ArchiveData, Person, Place } from '@southview/validators';
import { CitationMarks, SourceList } from './citations';
import { ProvidedBy } from './provided-by';
import { SiteNavigation } from './site-navigation';
import { withArchiveReturn } from '@/lib/archive-return';
import { displayPersonName } from '@/lib/person-name';
import { directionsUrl, placeConnections, precisionLabels } from '@/lib/place-mode';

function years(person: Person) {
  if (person.birthYear) return `${person.birthYear} — ${person.deathYear ?? ''}`;
  if (person.deathYear) return `Remembered · ${person.deathYear}`;
  return '';
}
function initials(name: string) {
  return name
    .split(' ')
    .filter((part) => !/^(Sr\.|Jr\.)$/.test(part))
    .filter((_, i, words) => i === 0 || i === words.length - 1)
    .map((part) => part[0])
    .join('');
}

/**
 * A place in its own right: what it is, where it is, and the lives connected to it. When the
 * reader arrives from one person's page, that person's connection comes first and is marked, so
 * a shared place never loses the life it was reached through.
 */
export function PlaceArchive({
  place,
  data,
  returnTo,
  canonicalUrl,
  fromPerson,
}: {
  place: Place;
  data: ArchiveData;
  returnTo: string;
  canonicalUrl: string;
  fromPerson?: Person;
}) {
  const connections = placeConnections(data, place.id, fromPerson?.id);
  const personHref = (person: Person) =>
    withArchiveReturn(`/people/${encodeURIComponent(person.id)}`, returnTo);
  const citations = [
    ...place.summaryCitations,
    ...place.coordinateCitations,
    ...connections.flatMap(({ relation }) => relation.citations),
  ];
  const usedSourceIds = new Set(citations.map((citation) => citation.sourceId));
  const sources = data.sources.filter((source) => usedSourceIds.has(source.id));
  const mapUrl = `/explore?scope=${place.scope}&place=${encodeURIComponent(place.id)}${
    place.coordinates
      ? `&lng=${place.coordinates[0]}&lat=${place.coordinates[1]}&z=${place.scope === 'cemetery' ? '17' : '15'}`
      : ''
  }`;
  const grave = place.scope === 'cemetery';
  return (
    <div className="archive-page">
      <SiteNavigation />
      <main id="main-content">
        <div className="archive-topbar">
          {fromPerson ? (
            <Link className="archive-back" href={personHref(fromPerson)}>
              <ArrowLeft size={18} aria-hidden="true" /> Back to{' '}
              {displayPersonName(fromPerson.name)}
            </Link>
          ) : (
            <Link className="archive-back" href={returnTo}>
              <ArrowLeft size={18} aria-hidden="true" /> Back to the map
            </Link>
          )}
          <a className="archive-permalink" href={canonicalUrl}>
            <ExternalLink size={16} aria-hidden="true" /> Permanent link
          </a>
        </div>
        <article className="archive-main archive-place-record">
          <p className="archive-eyebrow">
            {grave ? 'Grave marker · South-View Cemetery' : 'Place · Atlanta'}
          </p>
          <h1>{place.name}</h1>
          {place.address && <p className="archive-place-address">{place.address}</p>}
          <p className="archive-summary">
            {place.summary || connections[0]?.relation.description || place.locationNote}{' '}
            <CitationMarks
              citations={
                place.summary
                  ? place.summaryCitations
                  : (connections[0]?.relation.citations ?? place.coordinateCitations)
              }
              sources={data.sources}
            />
          </p>
          <ProvidedBy
            creditIds={place.creditIds}
            title={`${place.name}: location`}
            data={data}
            returnTo={returnTo}
          />
          <div className="archive-location-note">
            <span className={`precision-badge precision-${place.precision}`}>
              {precisionLabels[place.precision]}
            </span>
            <p>
              {place.locationNote}{' '}
              <CitationMarks citations={place.coordinateCitations} sources={data.sources} />
            </p>
          </div>
          {place.coordinates ? (
            <p className="archive-place-links">
              <Link className="archive-text-link" href={mapUrl}>
                <MapPin size={17} aria-hidden="true" /> Show on the map
              </Link>
              <a
                className="archive-text-link"
                href={directionsUrl(place.coordinates)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Navigation size={17} aria-hidden="true" /> Directions in Google Maps
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          ) : (
            <p className="archive-unmapped">A map position is not yet available for this place.</p>
          )}

          <section className="archive-section" aria-labelledby="place-people-heading">
            <p className="archive-eyebrow">{grave ? 'Remembered here' : 'Lives connected here'}</p>
            <h2 id="place-people-heading">
              {connections.length === 1 ? 'One life at this place' : 'People at this place'}
            </h2>
            {connections.length === 0 && (
              <p className="archive-empty">No person has been connected to this place yet.</p>
            )}
            {connections.map(({ person, relation }) => {
              const origin = person.id === fromPerson?.id;
              return (
                <article
                  className={`place-person${origin ? ' is-origin' : ''}`}
                  key={relation.id}
                  id={`person-${person.id}`}
                >
                  {origin && (
                    <p className="place-person-origin">The person whose page led you here</p>
                  )}
                  <Link className="place-person-identity" href={personHref(person)}>
                    {person.portrait ? (
                      <img src={person.portrait.url} alt="" />
                    ) : (
                      <span className="place-person-monogram" aria-hidden="true">
                        {initials(person.name)}
                        <Sprout size={16} strokeWidth={0.8} aria-hidden="true" />
                      </span>
                    )}
                    <span>
                      <strong>{displayPersonName(person.name)}</strong>
                      {years(person) && <small>{years(person)}</small>}
                    </span>
                  </Link>
                  <p className="archive-eyebrow">{relation.label}</p>
                  <p>
                    {relation.description}{' '}
                    <CitationMarks citations={relation.citations} sources={data.sources} />
                  </p>
                  <ProvidedBy
                    creditIds={relation.creditIds}
                    title={`${person.name}: connection`}
                    data={data}
                    returnTo={returnTo}
                  />
                  <Link className="archive-text-link" href={personHref(person)}>
                    {origin ? 'Back to' : 'Read more about'} {displayPersonName(person.name)}
                    <ArrowUpRight size={17} aria-hidden="true" />
                  </Link>
                </article>
              );
            })}
          </section>

          <section
            className="archive-section archive-sources"
            id="sources"
            aria-labelledby="sources-heading"
          >
            <p className="archive-eyebrow">Follow the evidence</p>
            <h2 id="sources-heading">Sources</h2>
            <p>
              Numbered references connect this place and each connection to its source. Original
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
      </main>
    </div>
  );
}
