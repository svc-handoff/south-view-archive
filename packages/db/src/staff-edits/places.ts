/**
 * Corrections to map places and to how people are connected to them.
 */
import { randomUUID } from 'node:crypto';
import {
  VERIFIED_ACCURACY_METRES,
  isGrave,
  placeSchema,
  relationSchema,
  staffBurialMapSchema,
  staffLinkCreateSchema,
  staffLinkEditSchema,
  staffPlaceEditSchema,
  staffReasonSchema,
  type Actor,
  type Citation,
  type Person,
  type PersonPlace,
  type Place,
  type StaffBurialMap,
  type StaffLinkCreate,
  type StaffLinkEdit,
  type StaffPlaceEdit,
} from '@southview/validators';
import { DomainError } from '../community';
import type { Store } from '../connection';
import { type Data, staffAction, existing, readRow } from './core';

/**
 * Corrects a map place: name, address, position, precision, location note, description. Its
 * area never changes here: a grave stays a grave and a place in Atlanta stays a place.
 */
export async function editPlace(placeId: string, raw: StaffPlaceEdit, actor: Actor) {
  const { patch, reason } = staffPlaceEditSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    const current = await existing<Place>(
      tx,
      'places',
      placeId,
      'This place is not in the archive.',
    );
    const next: Data = { ...current };
    for (const field of ['name', 'precision', 'locationNote', 'summary'] as const)
      if (patch[field] !== undefined) next[field] = patch[field];
    if (patch.address !== undefined) {
      if (patch.address) next.address = patch.address;
      else delete next.address;
    }
    if (patch.coordinates !== undefined) {
      next.coordinates = patch.coordinates;
      // Citations for a position no longer on the map would describe nothing.
      if (patch.coordinates === null) next.coordinateCitations = [];
      // A place mapped for the first time needs a citation, or the archive no longer validates.
      else if (!current.coordinateCitations.length) {
        next.coordinateCitations = await connectionCitations(tx, placeId);
        if (!(next.coordinateCitations as Citation[]).length)
          throw new DomainError(
            'BAD_REQUEST',
            'Connect someone to this place before giving it a map position, so the position has a source.',
          );
      }
    }
    const place = placeSchema.parse(next);
    return { result: { place }, reason, changes: [{ table: 'places', id: placeId, next: place }] };
  });
}

/** The sources behind everyone's connection to a place, once each. */
async function connectionCitations(tx: Store, placeId: string): Promise<Citation[]> {
  const links = await tx.query<{ data: PersonPlace }>(
    'SELECT data FROM archive.person_places WHERE place_id = $1 ORDER BY id',
    [placeId],
  );
  return uniqueCitations(links.rows.flatMap((row) => row.data.citations));
}
const uniqueCitations = (citations: Citation[]) => [
  ...new Map(citations.map((citation) => [citation.sourceId, citation])).values(),
];

/**
 * Records where a person is buried from a position measured at the grave with a device's
 * location. Their one cemetery place (or the one chosen) moves there; a person with none gets a
 * new grave place and a "Buried here" connection. Readings within VERIFIED_ACCURACY_METRES are
 * recorded as verified, coarser ones as a reference position, and the note gives the accuracy.
 */
export async function mapBurial(personId: string, raw: StaffBurialMap, actor: Actor) {
  const input = staffBurialMapSchema.parse(raw);
  return staffAction<{ place: Place; link?: PersonPlace }>(actor, async (tx) => {
    const person = await existing<Person>(
      tx,
      'persons',
      personId,
      'This person is not in the archive.',
    );
    const coordinates = input.coordinates.map((value) => Math.round(value * 1e6) / 1e6) as [
      number,
      number,
    ];
    const accuracy = Math.max(1, Math.round(input.accuracy));
    const precision = accuracy <= VERIFIED_ACCURACY_METRES ? 'verified' : 'reference';
    const day = new Date().toISOString().slice(0, 10);
    const locationNote = `Measured at the grave with a phone’s location on ${day}, accurate to about ${accuracy} m.`;
    const links = (
      await tx.query<{ data: PersonPlace }>(
        'SELECT data FROM archive.person_places WHERE person_id = $1 ORDER BY id',
        [personId],
      )
    ).rows.map((row) => row.data);
    const graves: Place[] = [];
    for (const link of links) {
      const place = (await readRow(tx, 'places', link.placeId)) as Place | null;
      if (place && isGrave(place) && !graves.some((item) => item.id === place.id))
        graves.push(place);
    }
    const chosen = input.placeId
      ? graves.find((place) => place.id === input.placeId)
      : graves.length === 1
        ? graves[0]
        : undefined;
    if (input.placeId && !chosen)
      throw new DomainError('BAD_REQUEST', 'Choose one of this person’s places in the cemetery.');
    if (!chosen && graves.length > 1)
      throw new DomainError(
        'CONFLICT',
        'This person has more than one place in the cemetery. Choose which one to move.',
      );
    if (chosen) {
      const citations = chosen.coordinateCitations.length
        ? chosen.coordinateCitations
        : uniqueCitations(
            links.filter((link) => link.placeId === chosen.id).flatMap((link) => link.citations),
          );
      const place = placeSchema.parse({
        ...chosen,
        coordinates,
        precision,
        locationNote,
        coordinateCitations: citations,
      });
      return {
        result: { place },
        reason: input.reason,
        changes: [{ table: 'places', id: place.id, next: place }],
      };
    }
    // No grave yet: the person's own sources say who they are; the reading says where.
    const citations = uniqueCitations(person.summaryCitations);
    const place = placeSchema.parse({
      id: `place-${randomUUID()}`,
      name: `Grave of ${person.name}`,
      scope: 'cemetery',
      coordinates,
      precision,
      locationNote,
      coordinateCitations: citations,
      summary: '',
      summaryCitations: [],
      creditIds: ['initial-compilation'],
    });
    const link = relationSchema.parse({
      id: `link-${randomUUID()}`,
      personId,
      placeId: place.id,
      label: 'Buried here',
      description: '',
      citations,
      creditIds: ['initial-compilation'],
    });
    return {
      result: { place, link },
      reason: input.reason,
      changes: [
        { table: 'places', id: place.id, next: place },
        { table: 'person_places', id: link.id, next: link },
      ],
    };
  });
}

/** Corrects how a person is connected to a place: the relationship label and its description. */
export async function editLink(linkId: string, raw: StaffLinkEdit, actor: Actor) {
  const { patch, reason } = staffLinkEditSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    const current = await existing<PersonPlace>(
      tx,
      'person_places',
      linkId,
      'This connection is not in the archive.',
    );
    const link = relationSchema.parse({
      ...current,
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
    });
    return {
      result: { link },
      reason,
      changes: [{ table: 'person_places', id: linkId, next: link }],
    };
  });
}

/**
 * Connects a person to a place already on the map. A grave takes only someone buried there
 * (`burial`, for a shared crypt or family lot); a place in Atlanta takes any other connection.
 */
export async function createLink(raw: StaffLinkCreate, actor: Actor) {
  const input = staffLinkCreateSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    await existing(tx, 'persons', input.personId, 'This person is not in the archive.');
    const place = await existing<Place>(
      tx,
      'places',
      input.placeId,
      'This place is not in the archive.',
    );
    if (isGrave(place) && !input.burial)
      throw new DomainError(
        'BAD_REQUEST',
        'That is a grave at South-View, not a place from someone’s life. Add a person buried there from the grave section of their record.',
      );
    if (!isGrave(place) && input.burial)
      throw new DomainError('BAD_REQUEST', 'Choose a grave at South-View Cemetery.');
    await existing(tx, 'sources', input.sourceId, 'Choose a source that is in the archive.');
    const duplicate = await tx.query(
      'SELECT id FROM archive.person_places WHERE person_id = $1 AND place_id = $2 LIMIT 1',
      [input.personId, input.placeId],
    );
    if (duplicate.rows.length)
      throw new DomainError(
        'CONFLICT',
        'This person is already connected to this place. Edit that connection instead.',
      );
    const link = relationSchema.parse({
      id: `link-${randomUUID()}`,
      personId: input.personId,
      placeId: input.placeId,
      label: input.label,
      description: input.description,
      citations: [{ sourceId: input.sourceId }],
      creditIds: ['initial-compilation'],
    });
    return {
      result: { link },
      reason: input.reason,
      changes: [{ table: 'person_places', id: link.id, next: link }],
    };
  });
}

/** Removes a person's connection to a place. The place itself stays on the map. */
export async function removeLink(linkId: string, rawReason: string, actor: Actor) {
  const reason = staffReasonSchema.parse(rawReason);
  return staffAction(actor, async (tx) => {
    await existing(tx, 'person_places', linkId, 'This connection is not in the archive.');
    return { result: {}, reason, changes: [{ table: 'person_places', id: linkId, next: null }] };
  });
}
