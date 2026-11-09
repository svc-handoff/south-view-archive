/**
 * Corrections to a published contribution's public entry.
 */
import { isDeepStrictEqual } from 'node:util';
import {
  contributionEntrySchema,
  personSchema,
  sourceSchema,
  staffContributionEditSchema,
  type Actor,
  type Person,
  type Source,
  type StaffContributionEdit,
  type ContributionEntry,
} from '@southview/validators';
import { DomainError } from '../community';
import { type Data, type StaffChange, staffAction, existing, checkRelated } from './core';

/**
 * Corrects a published contribution's public entry in place: its text, credits line, dates,
 * related records, featured flag, public note and photo captions, creators and rights. The
 * contribution's own source follows its title and creator, and a portrait copied from one of
 * its photographs follows that photograph's caption, creator and rights.
 */
export async function editContribution(entryId: string, raw: StaffContributionEdit, actor: Actor) {
  const { patch, reason } = staffContributionEditSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    const current = await existing<ContributionEntry>(
      tx,
      'contributions',
      entryId,
      'This contribution is not published.',
    );
    const next: Data = { ...current };
    for (const field of [
      'title',
      'body',
      'context',
      'sourceCreator',
      'narrator',
      'holdingInstitution',
      'eventDate',
      'featured',
      'relatedPersonIds',
      'placeIds',
    ] as const)
      if (patch[field] !== undefined) next[field] = patch[field];
    if (patch.publicNote !== undefined) {
      if (patch.publicNote) next.publicNote = patch.publicNote;
      else delete next.publicNote;
    }
    if (patch.photos) {
      for (const edit of patch.photos)
        if (!current.photos.some((photo) => photo.id === edit.id))
          throw new DomainError(
            'BAD_REQUEST',
            'A photograph does not belong to this contribution.',
          );
      next.photos = current.photos.map((photo) => {
        const edit = patch.photos!.find((item) => item.id === photo.id);
        return edit
          ? { ...photo, caption: edit.caption, creator: edit.creator, rights: edit.rights }
          : photo;
      });
    }
    await checkRelated(tx, current.personId, {
      relatedPersonIds: (next.relatedPersonIds as string[]) ?? [],
      placeIds: (next.placeIds as string[]) ?? [],
    });
    let entry = contributionEntrySchema.parse(next);
    if (isDeepStrictEqual(entry, contributionEntrySchema.parse(current)))
      return { result: { entry }, reason, changes: [] };
    entry = { ...entry, updatedAt: new Date().toISOString() };
    const changes: StaffChange[] = [{ table: 'contributions', id: entryId, next: entry }];

    // The contribution's own source carries its title and creator into every citation of it.
    const source = (
      await tx.query<{ data: Source }>(
        `SELECT data FROM archive.sources WHERE data->>'url' = $1 LIMIT 1`,
        [`/contributions/${entryId}`],
      )
    ).rows[0]?.data;
    if (source) {
      const credit = (
        await tx.query<{ data: { displayName: string } }>(
          'SELECT data FROM archive.credits WHERE id = $1',
          [entry.creditId],
        )
      ).rows[0]?.data;
      changes.push({
        table: 'sources',
        id: source.id,
        next: sourceSchema.parse({
          ...source,
          title: entry.title,
          creator: entry.sourceCreator || credit?.displayName || source.creator,
          publisher: entry.holdingInstitution || 'South-View community archive',
        }),
      });
    }
    for (const photo of entry.photos) {
      const before = current.photos.find((item) => item.id === photo.id);
      if (!before || isDeepStrictEqual(before, photo)) continue;
      const portraits = (
        await tx.query<{ data: Person }>(
          `SELECT data FROM archive.persons WHERE data->'portrait'->>'url' = $1`,
          [photo.url],
        )
      ).rows;
      for (const { data: person } of portraits)
        changes.push({
          table: 'persons',
          id: person.id,
          next: personSchema.parse({
            ...person,
            portrait: {
              ...person.portrait!,
              alt: photo.caption,
              credit: photo.creator,
              rights: photo.rights,
            },
          }),
        });
    }
    return { result: { entry }, reason, changes };
  });
}
