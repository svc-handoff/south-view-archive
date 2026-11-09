/**
 * Corrections to a person's own record: names, dates, themes, summary and story.
 */
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  applyLifeDates,
  personSchema,
  staffBiographySchema,
  staffPersonEditSchema,
  type Actor,
  type Person,
  type StaffBiography,
  type StaffPersonEdit,
} from '@southview/validators';
import { DomainError } from '../community';
import { type Data, staffAction, existing } from './core';

/** Corrects a person's own fields: name, other names, years, themes, summary. */
export async function editPerson(personId: string, raw: StaffPersonEdit, actor: Actor) {
  const { patch, reason } = staffPersonEditSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    const current = await existing<Person>(
      tx,
      'persons',
      personId,
      'This person is not in the archive.',
    );
    const next: Data = { ...current };
    if (patch.name !== undefined) next.name = patch.name;
    if (patch.aliases !== undefined) next.aliases = patch.aliases;
    if (patch.themes !== undefined) next.themes = patch.themes;
    if (patch.occupations !== undefined) {
      if (patch.occupations.length) next.occupations = patch.occupations;
      else delete next.occupations;
    }
    if (patch.summary !== undefined) next.summary = patch.summary;
    const conflict = applyLifeDates(next, patch);
    if (conflict) throw new DomainError('BAD_REQUEST', conflict);
    const person = personSchema.parse(next);
    return {
      result: { person },
      reason,
      changes: [{ table: 'persons', id: personId, next: person }],
    };
  });
}

/**
 * Rewrites a person's story: paragraphs corrected, removed, reordered or added, each citing at
 * least one archive source. Refused if the story changed after the editor loaded it. A corrected
 * paragraph keeps its credits; a new one is credited to the archive compilation.
 */
export async function editBiography(personId: string, raw: StaffBiography, actor: Actor) {
  const { base, paragraphs, reason } = staffBiographySchema.parse(raw);
  return staffAction(actor, async (tx) => {
    const current = await existing<Person>(
      tx,
      'persons',
      personId,
      'This person is not in the archive.',
    );
    if (!isDeepStrictEqual(current.biography, base))
      throw new DomainError(
        'CONFLICT',
        'This story changed after you opened it. Reload the page and make your change again.',
      );
    const used = new Set<number>();
    const sourceIds = new Set<string>();
    const biography = paragraphs.map((paragraph) => {
      const citations = paragraph.citations.map((citation) => {
        sourceIds.add(citation.sourceId);
        return citation.locator
          ? { sourceId: citation.sourceId, locator: citation.locator }
          : { sourceId: citation.sourceId };
      });
      if (paragraph.from === undefined)
        return {
          id: `staff-${randomUUID()}`,
          creditIds: ['initial-compilation'],
          text: paragraph.text,
          citations,
        };
      const original = current.biography[paragraph.from];
      if (!original || used.has(paragraph.from))
        throw new DomainError('BAD_REQUEST', 'The story’s paragraphs did not match. Reload.');
      used.add(paragraph.from);
      // Unchanged text and sources keep the paragraph exactly as stored.
      if (
        original.text === paragraph.text &&
        isDeepStrictEqual(
          original.citations.map((c) => ({
            sourceId: c.sourceId,
            locator: c.locator || undefined,
          })),
          citations.map((c) => ({ sourceId: c.sourceId, locator: c.locator })),
        )
      )
        return original;
      return { ...original, text: paragraph.text, citations };
    });
    for (const id of sourceIds)
      await existing(tx, 'sources', id, 'Choose sources that are in the archive.');
    const person = personSchema.parse({ ...current, biography });
    return {
      result: { person },
      reason,
      changes: [{ table: 'persons', id: personId, next: person }],
    };
  });
}
