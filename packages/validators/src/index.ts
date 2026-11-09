import { z } from 'zod';
import {
  creditSchema,
  contributionEntrySchema,
  eventDateSchema,
  lifeDateSchema,
  lifeDateYear,
} from './community';
import { matchedPersonIds } from './discovery';
export * from './community';
export * from './discovery';
export * from './auth';
export * from './vet';

export const citationSchema = z.object({ sourceId: z.string(), locator: z.string().optional() });
export const sourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  creator: z.string(),
  publisher: z.string(),
  url: z
    .string()
    .refine(
      (value) => /^https?:\/\//.test(value) || /^\/contributions\/[a-zA-Z0-9-]+$/.test(value),
      'A source must link to an original collection or a contribution.',
    ),
  accessedAt: z.string(),
  date: z.string().optional(),
  kind: z.enum([
    'document',
    'oral-history',
    'dataset',
    'image',
    'community-memory',
    'community-contribution',
  ]),
  creditIds: z.array(z.string()).default(['initial-compilation']),
  catalogueId: z.string().optional(),
  rights: z.string().optional(),
  note: z.string().optional(),
});
export const personSchema = z.object({
  creditIds: z.array(z.string()).default(['initial-compilation']),
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  birthYear: z.number().optional(),
  deathYear: z.number().optional(),
  /** A month or day refining birthYear (YYYY-MM or YYYY-MM-DD); its year equals birthYear. */
  birthDate: lifeDateSchema.optional(),
  deathDate: lifeDateSchema.optional(),
  themes: z.array(z.string()),
  /** What the person did, such as Pastor or Insurance executive; searchable tags. Absent when unknown. */
  occupations: z.array(z.string()).optional(),
  summary: z.string(),
  summaryCitations: z.array(citationSchema).min(1),
  biography: z.array(
    z.object({
      id: z.string().optional(),
      creditIds: z.array(z.string()).default(['initial-compilation']),
      text: z.string(),
      citations: z.array(citationSchema).min(1),
    }),
  ),
  portrait: z
    .object({
      url: z.string(),
      alt: z.string(),
      credit: z.string(),
      // The licence or rights statement shown with the image, copied from the approved photograph.
      rights: z.string().optional(),
      sourceId: z.string(),
      creditIds: z.array(z.string()).default(['initial-compilation']),
    })
    .optional(),
});
export const placeSchema = z.object({
  creditIds: z.array(z.string()).default(['initial-compilation']),
  id: z.string(),
  name: z.string(),
  scope: z.enum(['cemetery', 'atlanta']),
  coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).nullable(),
  address: z.string().optional(),
  precision: z.enum(['reference', 'address', 'verified', 'unmapped']),
  locationNote: z.string(),
  coordinateCitations: z.array(citationSchema),
  /** What this place is, independent of any one person. Empty for places described only by relationships. */
  summary: z.string().default(''),
  summaryCitations: z.array(citationSchema).default([]),
});
export const relationSchema = z.object({
  creditIds: z.array(z.string()).default(['initial-compilation']),
  id: z.string(),
  personId: z.string(),
  placeId: z.string(),
  label: z.string(),
  description: z.string(),
  citations: z.array(citationSchema).min(1),
});
export const materialSchema = z.object({
  creditIds: z.array(z.string()).default(['initial-compilation']),
  id: z.string(),
  personId: z.string(),
  relatedPersonIds: z.array(z.string()).default([]),
  placeIds: z.array(z.string()).default([]),
  eventDate: eventDateSchema.default({ kind: 'unknown' }),
  title: z.string(),
  kind: z.enum(['oral-history', 'document']),
  description: z.string(),
  sourceId: z.string(),
  narrator: z.string().optional(),
  interviewer: z.string().optional(),
  date: z.string().optional(),
});
export const issueSchema = z.object({
  /** The stored row's identifier, added when the archive is read. Not part of the stored data. */
  id: z.string().optional(),
  personId: z.string(),
  field: z.string(),
  note: z.string(),
  sourceIds: z.array(z.string()),
});
export const crosswalkSchema = z.object({
  project: z.string(),
  externalId: z.string(),
  personId: z.string().nullable(),
  note: z.string(),
});
export const archiveSchema = z.object({
  credits: z
    .array(creditSchema)
    .default([
      { id: 'initial-compilation', displayName: 'Initial archive compilation', kind: 'initial' },
    ]),
  contributions: z.array(contributionEntrySchema).default([]),
  people: z.array(personSchema),
  places: z.array(placeSchema),
  relations: z.array(relationSchema),
  materials: z.array(materialSchema),
  sources: z.array(sourceSchema),
  issues: z.array(issueSchema),
  crosswalk: z.array(crosswalkSchema),
});
export type Citation = z.infer<typeof citationSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Person = z.infer<typeof personSchema>;
export type Place = z.infer<typeof placeSchema>;
export type PersonPlace = z.infer<typeof relationSchema>;
export type Material = z.infer<typeof materialSchema>;
export type ArchiveData = z.infer<typeof archiveSchema>;
export type Scope = Place['scope'];
export const searchSchema = z.object({
  q: z.string().max(200).default(''),
  theme: z.string().max(80).default('all'),
  scope: z.enum(['cemetery', 'atlanta']).default('cemetery'),
});
export type SearchInput = z.infer<typeof searchSchema>;

/**
 * The rights statement to show with a portrait: the portrait's own, else its source's, else the
 * statement filed with the community photograph it was published from.
 */
export function portraitRights(
  person: Pick<Person, 'portrait'>,
  data: Pick<ArchiveData, 'sources' | 'contributions'>,
): string | undefined {
  const portrait = person.portrait;
  if (!portrait) return undefined;
  const source = data.sources.find((item) => item.id === portrait.sourceId);
  const photo = data.contributions
    .flatMap((entry) => entry.photos)
    .find((item) => item.url === portrait.url);
  return portrait.rights?.trim() || source?.rights?.trim() || photo?.rights?.trim() || undefined;
}

/** Atlanta is the wider view and includes South-View; place records keep their own scope. */
export function scopeIncludesPlace(view: Scope, placeScope: Scope) {
  return view === 'atlanta' || placeScope === 'cemetery';
}

export function searchArchive(data: ArchiveData, input: SearchInput) {
  const query = input.q.trim().toLocaleLowerCase();
  const matches = query ? matchedPersonIds(data, query) : null;
  const people = data.people.filter((person) => {
    return (
      (input.theme === 'all' || person.themes.includes(input.theme)) &&
      (!matches || matches.has(person.id))
    );
  });
  const ids = new Set(people.map((p) => p.id));
  const relations = data.relations.filter(
    (r) =>
      ids.has(r.personId) &&
      data.places.some((p) => p.id === r.placeId && scopeIncludesPlace(input.scope, p.scope)),
  );
  const placeIds = new Set(relations.map((r) => r.placeId));
  const places = data.places.filter((p) => placeIds.has(p.id));
  return { people, places, relations };
}

export function validateArchive(input: unknown): ArchiveData {
  const data = archiveSchema.parse(input);
  for (const key of [
    'people',
    'places',
    'relations',
    'materials',
    'sources',
    'credits',
    'contributions',
  ] as const) {
    const ids = data[key].map((item) => item.id);
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${key} IDs`);
  }
  const sourceIds = new Set(data.sources.map((s) => s.id));
  const peopleIds = new Set(data.people.map((p) => p.id));
  const placeIds = new Set(data.places.map((p) => p.id));
  const creditIds = new Set(data.credits.map((c) => c.id));
  const checkCredits = (ids: string[]) =>
    ids.forEach((id) => {
      if (!creditIds.has(id)) throw new Error(`Missing credit: ${id}`);
    });
  const checkRelated = (item: {
    personId: string;
    relatedPersonIds: string[];
    placeIds: string[];
  }) => {
    if (
      new Set(item.relatedPersonIds).size !== item.relatedPersonIds.length ||
      item.relatedPersonIds.includes(item.personId)
    )
      throw new Error('Duplicate related person');
    for (const id of item.relatedPersonIds) {
      if (!peopleIds.has(id)) throw new Error(`Missing related person: ${id}`);
    }
    if (new Set(item.placeIds).size !== item.placeIds.length)
      throw new Error('Duplicate related place');
    for (const id of item.placeIds) {
      if (!placeIds.has(id)) throw new Error(`Missing related place: ${id}`);
    }
  };
  [...data.people, ...data.places, ...data.relations, ...data.materials, ...data.sources].forEach(
    (item) => checkCredits(item.creditIds),
  );
  data.people.forEach((p) => {
    p.biography.forEach((b) => checkCredits(b.creditIds));
    if (p.portrait) checkCredits(p.portrait.creditIds);
  });
  data.contributions.forEach((entry) => {
    if (!peopleIds.has(entry.personId)) throw new Error('Broken contribution person');
    checkRelated(entry);
    checkCredits([entry.creditId]);
    entry.sourceIds.forEach((id) => {
      if (!sourceIds.has(id)) throw new Error(`Missing contribution source: ${id}`);
    });
    entry.photos.forEach((photo) => checkCredits([photo.creditId]));
  });
  const checkCitations = (citations: Citation[]) =>
    citations.forEach((c) => {
      if (!sourceIds.has(c.sourceId)) throw new Error(`Missing source: ${c.sourceId}`);
    });
  data.people.forEach((p) => {
    checkCitations(p.summaryCitations);
    p.biography.forEach((b) => checkCitations(b.citations));
    if (p.portrait && !sourceIds.has(p.portrait.sourceId))
      throw new Error(`Missing portrait source: ${p.id}`);
    if (p.birthDate && lifeDateYear(p.birthDate) !== p.birthYear)
      throw new Error(`Birth date does not match the birth year: ${p.id}`);
    if (p.deathDate && lifeDateYear(p.deathDate) !== p.deathYear)
      throw new Error(`Death date does not match the death year: ${p.id}`);
  });
  data.places.forEach((p) => {
    checkCitations(p.coordinateCitations);
    if (p.coordinates && (!p.coordinateCitations.length || p.precision === 'unmapped'))
      throw new Error(`Uncited location: ${p.id}`);
    if (!p.coordinates && p.precision !== 'unmapped')
      throw new Error(`Missing coordinates: ${p.id}`);
  });
  data.relations.forEach((r) => {
    if (!peopleIds.has(r.personId) || !placeIds.has(r.placeId))
      throw new Error(`Broken relation: ${r.id}`);
    checkCitations(r.citations);
  });
  data.materials.forEach((m) => {
    if (!peopleIds.has(m.personId) || !sourceIds.has(m.sourceId))
      throw new Error(`Broken material: ${m.id}`);
    checkRelated(m);
  });
  data.issues.forEach((i) => {
    if (!peopleIds.has(i.personId)) throw new Error('Broken issue');
    i.sourceIds.forEach((id) => {
      if (!sourceIds.has(id)) throw new Error(`Missing issue source: ${id}`);
    });
  });
  data.crosswalk.forEach((c) => {
    if (c.personId && !peopleIds.has(c.personId)) throw new Error('Broken crosswalk');
  });
  return data;
}
