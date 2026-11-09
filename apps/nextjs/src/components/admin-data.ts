'use client';
import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ArchiveData,
  ContributionEntry,
  Material,
  Person,
  PersonPlace,
  Place,
  Source,
  StaffEdit,
} from '@southview/validators';

type Issue = ArchiveData['issues'][number];

type Overrides = Record<string, Record<string, unknown> | null>;
const key = (table: string, id: string) => `${table}:${id}`;

function merge<T extends { id?: string }>(rows: T[], table: string, overrides: Overrides): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    if (!row.id) {
      result.push(row);
      continue;
    }
    seen.add(row.id);
    const override = overrides[key(table, row.id)];
    if (override === undefined) result.push(row);
    else if (override !== null) result.push(override as unknown as T);
  }
  for (const [name, data] of Object.entries(overrides)) {
    const [overrideTable, ...rest] = name.split(':');
    const id = rest.join(':');
    if (overrideTable === table && data && !seen.has(id)) result.push(data as unknown as T);
  }
  return result;
}

/**
 * The archive as the admin should show it: the page's server data with every change saved in
 * this visit applied on top, so edits appear at once while the server data refreshes behind.
 */
export function useAdminArchive(archive: ArchiveData) {
  const router = useRouter();
  const [overrides, setOverrides] = useState<Overrides>({});
  const merged = useMemo<ArchiveData>(
    () => ({
      ...archive,
      people: merge<Person>(archive.people, 'persons', overrides),
      places: merge<Place>(archive.places, 'places', overrides),
      relations: merge<PersonPlace>(archive.relations, 'person_places', overrides),
      materials: merge<Material>(archive.materials, 'materials', overrides),
      sources: merge<Source>(archive.sources, 'sources', overrides),
      issues: merge<Issue>(archive.issues, 'issues', overrides),
      contributions: merge<ContributionEntry>(archive.contributions, 'contributions', overrides),
    }),
    [archive, overrides],
  );
  const apply = useCallback(
    (edits: StaffEdit[]) => {
      if (!edits.length) return;
      setOverrides((current) => {
        const next = { ...current };
        // Issue rows keep their identifier outside the stored data; carry it on every row.
        for (const edit of edits)
          next[key(edit.targetTable, edit.targetId)] = edit.next
            ? { ...edit.next, id: edit.targetId }
            : null;
        return next;
      });
      router.refresh();
    },
    [router],
  );
  return { archive: merged, apply };
}
