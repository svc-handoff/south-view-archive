'use client';
import { useId } from 'react';
import type { EventDate } from '@southview/validators';

const labels = {
  public: {
    kind: 'Date certainty',
    unknown: 'I don’t know the date',
    year: 'Known year',
    approximate: 'Around a year',
    range: 'A range of years',
    from: 'First year',
    to: 'Last year',
  },
  staff: {
    kind: 'Date',
    unknown: 'Unknown',
    year: 'In a year',
    approximate: 'Around a year',
    range: 'Between two years',
    from: 'From',
    to: 'To',
  },
};

const startOf = (date: EventDate) =>
  date.kind === 'year' || date.kind === 'approximate'
    ? date.year
    : date.kind === 'range'
      ? date.startYear
      : 0;

/** Why a date from these fields cannot be saved, or null. Years are whole numbers 1–9999. */
export function eventDateProblem(date: EventDate): string | null {
  if (date.kind === 'unknown') return null;
  const valid = (year: number) => Number.isInteger(year) && year >= 1 && year <= 9999;
  if (!valid(startOf(date))) return 'Enter the year as a number, or choose an unknown date.';
  if (date.kind === 'range') {
    if (!valid(date.endYear)) return 'Enter the last year as a number.';
    if (date.endYear < date.startYear) return 'The last year must not be before the first.';
  }
  return null;
}

/**
 * When something happened: unknown, a year, around a year, or a range of years. Contributors
 * and staff see their own wording for the same choices.
 */
export function EventDateFields({
  value,
  onChange,
  wording = 'public',
}: {
  value: EventDate;
  onChange: (next: EventDate) => void;
  wording?: 'public' | 'staff';
}) {
  const id = useId();
  const text = labels[wording];
  return (
    <>
      <label className="community-field" htmlFor={`${id}-kind`}>
        <span>{text.kind}</span>
        <select
          id={`${id}-kind`}
          value={value.kind}
          onChange={(event) => {
            const kind = event.target.value as EventDate['kind'];
            const year = startOf(value);
            onChange(
              kind === 'unknown'
                ? { kind }
                : kind === 'range'
                  ? {
                      kind,
                      startYear: year,
                      endYear: value.kind === 'range' ? value.endYear : year,
                    }
                  : { kind, year },
            );
          }}
        >
          <option value="unknown">{text.unknown}</option>
          <option value="year">{text.year}</option>
          <option value="approximate">{text.approximate}</option>
          <option value="range">{text.range}</option>
        </select>
      </label>
      {value.kind !== 'unknown' && (
        <div className="community-two-columns event-date-years">
          <label className="community-field">
            <span>{value.kind === 'range' ? text.from : 'Year'}</span>
            <input
              type="number"
              min={1}
              max={9999}
              step={1}
              required
              value={startOf(value) || ''}
              onChange={(event) =>
                onChange(
                  value.kind === 'range'
                    ? { ...value, startYear: Number(event.target.value) }
                    : { ...value, year: Number(event.target.value) },
                )
              }
            />
          </label>
          {value.kind === 'range' && (
            <label className="community-field">
              <span>{text.to}</span>
              <input
                type="number"
                min={value.startYear || 1}
                max={9999}
                step={1}
                required
                value={value.endYear || ''}
                onChange={(event) => onChange({ ...value, endYear: Number(event.target.value) })}
              />
            </label>
          )}
        </div>
      )}
    </>
  );
}
