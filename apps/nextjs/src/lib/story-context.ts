import type { EventDate } from '@southview/validators';

// Zero is an unfinished form value, never a valid submitted or public event year.
export function restoreDraftEventDate(value: unknown): EventDate {
  if (!value || typeof value !== 'object') return { kind: 'unknown' };
  const date = value as Record<string, unknown>;
  const year = (input: unknown): number =>
    typeof input === 'number' && Number.isInteger(input) && input >= 0 && input <= 9999 ? input : 0;
  if (date.kind === 'year' || date.kind === 'approximate')
    return { kind: date.kind, year: year(date.year) };
  if (date.kind === 'range')
    return { kind: 'range', startYear: year(date.startYear), endYear: year(date.endYear) };
  return { kind: 'unknown' };
}
