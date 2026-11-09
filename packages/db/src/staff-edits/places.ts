/**
 * Corrections to map places and to how people are connected to them.
 */
import { randomUUID } from 'node:crypto';
import {
  placeSchema,
  relationSchema,
  staffLinkCreateSchema,
  staffLinkEditSchema,
  staffPlaceEditSchema,
  staffReasonSchema,
  type Actor,
  type PersonPlace,
  type Place,
  type StaffLinkCreate,
  type StaffLinkEdit,
  type StaffPlaceEdit,
} from '@southview/validators';
import { DomainError } from '../community';
import { type Data, staffAction, existing } from './core';

/** Corrects a map place: name, area, address, position, precision, location note, description. */
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
    for (const field of ['name', 'scope', 'precision', 'locationNote', 'summary'] as const)
      if (patch[field] !== undefined) next[field] = patch[field];
    if (patch.address !== undefined) {
      if (patch.address) next.address = patch.address;
      else delete next.address;
    }
    if (patch.coordinates !== undefined) {
      next.coordinates = patch.coordinates;
      // Citations for a position no longer on the map would describe nothing.
      if (patch.coordinates === null) next.coordinateCitations = [];
    }
    const place = placeSchema.parse(next);
    return { result: { place }, reason, changes: [{ table: 'places', id: placeId, next: place }] };
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

/** Connects a person to a place already on the map. */
export async function createLink(raw: StaffLinkCreate, actor: Actor) {
  const input = staffLinkCreateSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    await existing(tx, 'persons', input.personId, 'This person is not in the archive.');
    await existing(tx, 'places', input.placeId, 'This place is not in the archive.');
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
