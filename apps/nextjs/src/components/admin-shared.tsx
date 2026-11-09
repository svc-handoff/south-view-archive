'use client';
import { useCallback, useState, type ReactNode } from 'react';
import type { ArchiveData, Person, StaffEdit } from '@southview/validators';
import { communityRequest } from '@/lib/community-client';

/** Pieces every Archive admin editor shares: the reason rule, requests, and source lookups. */

export const errorText = (failure: unknown, fallback: string) =>
  failure instanceof Error ? failure.message : fallback;

export const missingReason = 'Say briefly why you are making this change.';
/** The notice after a save: the message, or that the save found nothing to change. */
export const savedMessage = (edits: StaffEdit[], message: string) =>
  edits.length ? message : 'Nothing changed.';
export const hasReason = (reason: string) => reason.trim().length >= 3;

/**
 * Sends one staff change: checks the reason, posts the body with it, and returns the rows the
 * server wrote, or null after showing why it failed. `busy` and `error` follow the latest call.
 */
export function useStaffRequest() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = useCallback(
    async (
      path: string,
      body: Record<string, unknown>,
      reason: string,
      messages: { missingReason?: string; failure?: string } = {},
    ): Promise<StaffEdit[] | null> => {
      if (!hasReason(reason)) {
        setError(messages.missingReason ?? missingReason);
        return null;
      }
      setBusy(true);
      setError('');
      try {
        const result = await communityRequest<{ edits: StaffEdit[] }>(path, {
          method: 'POST',
          body: JSON.stringify({ ...body, reason: reason.trim() }),
        });
        return result.edits;
      } catch (failure) {
        setError(errorText(failure, messages.failure ?? 'The change could not be saved.'));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );
  return { busy, error, setError, send };
}

/** The required reason for a staff change, shown to other staff in the history. */
export function ReasonField({
  value,
  onChange,
  label = 'Reason *',
  placeholder,
  hint = 'Shown to other staff in the change history. Not shown publicly.',
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  hint?: string | null;
  autoFocus?: boolean;
}) {
  return (
    <label className="community-field">
      <span>{label}</span>
      <input
        value={value}
        maxLength={1000}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** Sources this person's page already cites, offered first when choosing one. */
export function personSourceIds(person: Person, archive: ArchiveData) {
  return new Set([
    ...person.summaryCitations.map((item) => item.sourceId),
    ...person.biography.flatMap((block) => block.citations.map((item) => item.sourceId)),
    ...archive.relations
      .filter((item) => item.personId === person.id)
      .flatMap((item) => item.citations.map((citation) => citation.sourceId)),
    ...archive.materials.filter((item) => item.personId === person.id).map((item) => item.sourceId),
    ...archive.issues
      .filter((item) => item.personId === person.id)
      .flatMap((item) => item.sourceIds),
    ...(person.portrait ? [person.portrait.sourceId] : []),
  ]);
}

/** A collapsible list of checkboxes for choosing related records. */
export function Checklist<T extends { id: string }>({
  legend,
  items,
  selected,
  label,
  onChange,
}: {
  legend: string;
  items: T[];
  selected: string[];
  label: (item: T) => ReactNode;
  onChange: (ids: string[]) => void;
}) {
  return (
    <details className="admin-checklist" open={selected.length > 0}>
      <summary className="community-text-button">
        {legend} ({selected.length})
      </summary>
      <div className="community-fields">
        {items.map((item) => (
          <label className="community-check" key={item.id}>
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, item.id]
                    : selected.filter((id) => id !== item.id),
                )
              }
            />
            <span>{label(item)}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
