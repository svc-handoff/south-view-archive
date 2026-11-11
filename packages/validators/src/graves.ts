/**
 * Graves and places, kept apart. Everything mapped inside South-View Cemetery is a grave, and
 * the people connected to it are the people buried there (a family crypt or lot can hold
 * several). Everything else is a place from their lives in Atlanta. A grave belongs to its
 * people: it is never offered, and never accepted, as a related place of anyone else.
 */
type PlaceLike = { id: string; scope: 'cemetery' | 'atlanta' };
type RelationLike = { personId: string; placeId: string };

/** Whether a place is a grave at South-View rather than a place in Atlanta. */
export const isGrave = (place: { scope: string }) => place.scope === 'cemetery';

/** Everyone connected to a grave, once each, in the order they were connected. */
export function graveOccupants(data: { relations: RelationLike[] }, placeId: string): string[] {
  return [
    ...new Set(
      data.relations.filter((item) => item.placeId === placeId).map((item) => item.personId),
    ),
  ];
}

/** A person's graves: the South-View places they are connected to, once each. */
export function personGraves<P extends PlaceLike>(
  data: { places: P[]; relations: RelationLike[] },
  personId: string,
): P[] {
  const ids = new Set(
    data.relations.filter((item) => item.personId === personId).map((item) => item.placeId),
  );
  return data.places.filter((place) => ids.has(place.id) && isGrave(place));
}

/**
 * Whether a place may be a related place of a record about `personId`: any place in Atlanta,
 * and only the person's own grave at South-View.
 */
export function canRelatePlace(
  data: { places: PlaceLike[]; relations: RelationLike[] },
  placeId: string,
  personId: string | null | undefined,
) {
  const place = data.places.find((item) => item.id === placeId);
  if (!place || !isGrave(place)) return true;
  return !!personId && graveOccupants(data, placeId).includes(personId);
}

/**
 * The places a picker may offer as a record's related places: every place in Atlanta, the
 * person's own graves, and anything already chosen, so a save never drops a choice unseen.
 */
export function relatedPlaceOptions<P extends PlaceLike>(
  data: { places: P[]; relations: RelationLike[] },
  personId: string | null | undefined,
  keep: readonly string[] = [],
): P[] {
  const kept = new Set(keep);
  return data.places.filter(
    (place) => kept.has(place.id) || canRelatePlace(data, place.id, personId),
  );
}

/** "Grave of A", "Grave of A and B", "Grave of A, B and C": a grave named by its people. */
export function graveTitle(names: readonly string[]) {
  if (!names.length) return 'Grave with no one connected';
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Grave of ${list}`;
}
