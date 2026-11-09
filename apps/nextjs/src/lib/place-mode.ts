type Relation = { personId: string; placeId: string };
type PlaceLike = { id: string; scope: 'cemetery' | 'atlanta' };

/**
 * Google Maps directions to a mapped place, from wherever the visitor is. Coordinates are stored
 * longitude first; Google expects latitude first.
 */
export function directionsUrl(coordinates: [number, number]) {
  const [longitude, latitude] = coordinates;
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}

export const precisionLabels = {
  reference: 'Reference position · unverified',
  address: 'Approximate address position',
  verified: 'Verified position',
  unmapped: 'Not yet mapped',
} as const;

/**
 * Everyone connected to a place, each with the relation that connects them. When the reader
 * arrived from one person's record, that person's connection comes first, so a shared place
 * never loses the life it was reached through.
 */
export function placeConnections<R extends Relation, P extends { id: string }>(
  archive: { people: P[]; relations: R[] },
  placeId: string,
  fromPersonId?: string | null,
): { relation: R; person: P }[] {
  return archive.relations
    .filter((relation) => relation.placeId === placeId)
    .flatMap((relation) => {
      const person = archive.people.find((item) => item.id === relation.personId);
      return person ? [{ relation, person }] : [];
    })
    .sort((a, b) => Number(b.person.id === fromPersonId) - Number(a.person.id === fromPersonId));
}

/**
 * A grave with a single person is that person's marker: selecting it opens the person, as it
 * always did. Everything else, a family crypt, a church, a city hall, is a shared place that
 * opens as a place and lists everyone connected to it. Returns the sole occupant's id, or null.
 */
export function soleOccupant(
  archive: { places: PlaceLike[]; relations: Relation[] },
  placeId: string | null | undefined,
): string | null {
  if (!placeId) return null;
  const place = archive.places.find((item) => item.id === placeId);
  if (!place || place.scope !== 'cemetery') return null;
  const people = new Set(
    archive.relations.filter((relation) => relation.placeId === placeId).map((r) => r.personId),
  );
  return people.size === 1 ? [...people][0]! : null;
}
