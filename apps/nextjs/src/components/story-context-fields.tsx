'use client';
import type { EventDate } from '@southview/validators';
import type { RecordOption } from '@/lib/record-options';
import { RecordPicker } from './record-picker';
import { EventDateFields } from './event-date-fields';

export type StoryContext = { relatedPersonIds: string[]; placeIds: string[]; eventDate: EventDate };
export function StoryContextFields({
  people,
  places,
  primaryPersonId,
  value,
  onChange,
  showPlaces = true,
}: {
  people: RecordOption[];
  places: RecordOption[];
  primaryPersonId: string;
  value: StoryContext;
  onChange: (next: StoryContext) => void;
  showPlaces?: boolean;
}) {
  return (
    <div className="story-context-fields">
      <RecordPicker
        label="Other people in this story (optional)"
        multiple
        placeholder="Search names or alternate names…"
        options={people.filter((person) => person.id !== primaryPersonId)}
        value={value.relatedPersonIds.filter((key) => key !== primaryPersonId)}
        onChange={(ids) => onChange({ ...value, relatedPersonIds: ids })}
      />
      {showPlaces && (
        <div>
          <RecordPicker
            label="Places mentioned (optional)"
            multiple
            placeholder="Search places…"
            options={places}
            value={value.placeIds}
            onChange={(ids) => onChange({ ...value, placeIds: ids })}
          />
          <p className="community-hint">
            Choose places this material is about. Reviewers confirm these links; they do not
            establish a precise location.
          </p>
        </div>
      )}
      <fieldset>
        <legend>When did the event or memory take place?</legend>
        <EventDateFields
          value={value.eventDate}
          onChange={(eventDate) => onChange({ ...value, eventDate })}
        />
        <p className="community-hint" style={{ marginTop: 10 }}>
          This is when the story happened, separate from when it is submitted or published. An
          approximate or unknown date is welcome.
        </p>
      </fieldset>
    </div>
  );
}
