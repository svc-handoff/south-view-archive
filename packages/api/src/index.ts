import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { getArchive } from '@southview/db';
import {
  searchArchive,
  searchSchema,
  publicRelatedPersonIds,
  type ArchiveData,
  type Scope,
  type SearchInput,
} from '@southview/validators';

export type ArchiveFeatureCollection = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: {
      placeId: string;
      name: string;
      scope: Scope;
      precision: string;
      locationNote: string;
      personIds: string[];
    };
  }[];
};

export function archiveMapFeatures(
  data: ArchiveData,
  input: SearchInput,
): ArchiveFeatureCollection {
  const selected = searchArchive(data, input);
  return {
    type: 'FeatureCollection',
    features: selected.places.flatMap((place) =>
      place.coordinates
        ? [
            {
              type: 'Feature' as const,
              id: place.id,
              geometry: { type: 'Point' as const, coordinates: place.coordinates },
              properties: {
                placeId: place.id,
                name: place.name,
                scope: place.scope,
                precision: place.precision,
                locationNote: place.locationNote,
                personIds: [
                  ...new Set(
                    selected.relations
                      .filter((relation) => relation.placeId === place.id)
                      .map((relation) => relation.personId),
                  ),
                ],
              },
            },
          ]
        : [],
    ),
  };
}

export function archiveSearch(data: ArchiveData, input: SearchInput) {
  const selected = searchArchive(data, input);
  const features = archiveMapFeatures(data, input);
  const mappedPeople = new Set(
    features.features.flatMap((feature) => feature.properties.personIds),
  );
  return {
    ...selected,
    total: selected.people.length,
    mappedPeopleCount: mappedPeople.size,
    mappedPlaceCount: features.features.length,
  };
}

const t = initTRPC.context<Record<string, never>>().create();
const archiveRouter = t.router({
  snapshot: t.procedure.query(() => getArchive()),
  search: t.procedure
    .input(searchSchema)
    .query(async ({ input }) => archiveSearch(await getArchive(), input)),
  mapFeatures: t.procedure
    .input(searchSchema)
    .query(async ({ input }) => archiveMapFeatures(await getArchive(), input)),
  person: t.procedure
    .input(z.object({ id: z.string().min(1).max(100) }))
    .query(async ({ input }) => {
      const data = await getArchive();
      const person = data.people.find((item) => item.id === input.id);
      if (!person)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'This person is not in the public archive.',
        });
      const relations = data.relations.filter((item) => item.personId === person.id);
      const placeIds = new Set(relations.map((item) => item.placeId));
      const places = data.places.filter((item) => placeIds.has(item.id));
      const materials = data.materials.filter((item) =>
        publicRelatedPersonIds(item).includes(person.id),
      );
      const contributions = data.contributions.filter((item) =>
        publicRelatedPersonIds(item).includes(person.id),
      );
      const issues = data.issues.filter((item) => item.personId === person.id);
      const sourceIds = new Set([
        ...person.summaryCitations.map((item) => item.sourceId),
        ...person.biography.flatMap((paragraph) =>
          paragraph.citations.map((item) => item.sourceId),
        ),
        ...relations.flatMap((item) => item.citations.map((citation) => citation.sourceId)),
        ...places.flatMap((item) => item.coordinateCitations.map((citation) => citation.sourceId)),
        ...materials.map((item) => item.sourceId),
        ...contributions.flatMap((item) => item.sourceIds),
        ...issues.flatMap((item) => item.sourceIds),
        ...(person.portrait ? [person.portrait.sourceId] : []),
      ]);
      return {
        person,
        places,
        relations,
        materials,
        contributions,
        credits: data.credits,
        issues,
        sources: data.sources.filter((item) => sourceIds.has(item.id)),
      };
    }),
});

export const appRouter = t.router({ archive: archiveRouter });
export const createCaller = t.createCallerFactory(appRouter);
export type AppRouter = typeof appRouter;
