import { index, jsonb, pgSchema, primaryKey, text } from 'drizzle-orm/pg-core';
import type {
  ArchiveData,
  Material,
  Person,
  PersonPlace,
  Place,
  Source,
} from '@southview/validators';

// Kept outside public: the Next.js server owns access to the archive.
const archive = pgSchema('archive');

export const credits = archive.table('credits', {
  id: text('id').primaryKey(),
  data: jsonb('data').$type<ArchiveData['credits'][number]>().notNull(),
});

export const sources = archive.table('sources', {
  id: text('id').primaryKey(),
  data: jsonb('data').$type<Source>().notNull(),
});
export const persons = archive.table('persons', {
  id: text('id').primaryKey(),
  data: jsonb('data').$type<Person>().notNull(),
});
export const places = archive.table('places', {
  id: text('id').primaryKey(),
  data: jsonb('data').$type<Place>().notNull(),
});
export const personPlaces = archive.table(
  'person_places',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => persons.id),
    placeId: text('place_id')
      .notNull()
      .references(() => places.id),
    data: jsonb('data').$type<PersonPlace>().notNull(),
  },
  (table) => [
    index('person_places_person_idx').on(table.personId),
    index('person_places_place_idx').on(table.placeId),
  ],
);
export const materials = archive.table(
  'materials',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => persons.id),
    sourceId: text('source_id')
      .notNull()
      .references(() => sources.id),
    data: jsonb('data').$type<Material>().notNull(),
  },
  (table) => [index('materials_person_idx').on(table.personId)],
);
export const issues = archive.table('issues', {
  id: text('id').primaryKey(),
  personId: text('person_id')
    .notNull()
    .references(() => persons.id),
  data: jsonb('data').$type<ArchiveData['issues'][number]>().notNull(),
});
export const crosswalk = archive.table(
  'crosswalk',
  {
    project: text('project').notNull(),
    externalId: text('external_id').notNull(),
    personId: text('person_id').references(() => persons.id),
    data: jsonb('data').$type<ArchiveData['crosswalk'][number]>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.project, table.externalId] })],
);
export const contributions = archive.table('contributions', {
  id: text('id').primaryKey(),
  personId: text('person_id')
    .notNull()
    .references(() => persons.id),
  creditId: text('credit_id')
    .notNull()
    .references(() => credits.id),
  data: jsonb('data').$type<ArchiveData['contributions'][number]>().notNull(),
});
