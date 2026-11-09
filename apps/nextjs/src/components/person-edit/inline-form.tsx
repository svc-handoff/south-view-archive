'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, ImagePlus, Trash2, X } from 'lucide-react';
import { RecordPicker } from '../record-picker';
import { LocationPicker } from '../location-picker';
import {
  defaultBlockTitle,
  validateBlock,
  MAX_BLOCK_PHOTOS,
  type BlockIssue,
  type EditBlock,
  type EditKind,
  type EditPhotoDraft,
  type EditSection,
} from '@/lib/person-edit';
import type { RecordOption } from '@/lib/record-options';

const prompts: Record<
  EditSection,
  { heading: string; body: string; bodyHint: string; context?: string }
> = {
  biography: {
    heading: 'Add to their story',
    body: 'What should be added?',
    bodyHint: 'Write it as you would like readers to see it. Reviewers may lightly edit.',
    context: 'How do you know this? A source, a relative, your own memory…',
  },
  places: {
    heading: 'Add a place',
    body: 'How was this place part of their life?',
    bodyHint: 'A home, a church, a workplace, a school, or where they are buried.',
    context: 'How do you know this?',
  },
  community: {
    heading: 'Add a memory or photograph',
    body: 'Your memory',
    bodyHint: 'In your own words. A memory can be personal; it does not need to be proven.',
    context: 'Your connection to this person',
  },
  portrait: {
    heading: 'Add a photograph',
    body: 'Tell us about this photograph',
    bodyHint: 'Who is in it, where it was taken, and roughly when, if you know.',
  },
};

/** An existing place relationship on the page, offered for editing in place. */
export type ExistingPlace = {
  relationId: string;
  placeId: string;
  name: string;
  description: string;
  summary: string;
  coordinates: [number, number] | null;
  scope: 'cemetery' | 'atlanta';
};

function emptyBlock(
  section: EditSection,
  kind: EditKind,
  anchor?: string,
  original?: string,
  place?: ExistingPlace,
): EditBlock {
  if (place)
    return {
      id: crypto.randomUUID(),
      section: 'places',
      kind: 'correction',
      anchor: place.relationId,
      originalText: place.description,
      originalName: place.name,
      originalCoordinates: place.coordinates,
      placeSummary: place.summary,
      originalPlaceSummary: place.summary,
      title: '',
      body: place.description,
      context: '',
      placeIds: [place.placeId],
      proposedPlaceName: place.name,
      coordinates: place.coordinates,
      scope: place.scope,
      photos: [],
    };
  return {
    id: crypto.randomUUID(),
    section,
    kind,
    anchor,
    ...(kind === 'correction' && original ? { originalText: original } : {}),
    title: '',
    body: kind === 'correction' ? (original ?? '') : '',
    context: '',
    placeIds: [],
    proposedPlaceName: '',
    photos: [],
  };
}

export function InlineForm({
  section,
  kind,
  anchor,
  original,
  place,
  initial,
  personName,
  places,
  onSave,
  onCancel,
}: {
  section: EditSection;
  kind: EditKind;
  anchor?: string;
  original?: string;
  place?: ExistingPlace;
  initial?: EditBlock;
  personName: string;
  places: RecordOption[];
  onSave: (block: EditBlock) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [block, setBlock] = useState<EditBlock>(
    () => initial ?? emptyBlock(section, kind, anchor, original, place),
  );
  const correction = kind === 'correction';
  const placeEdit = section === 'places' && correction;
  const heading = placeEdit
    ? 'Edit this place'
    : correction
      ? 'Edit this paragraph'
      : prompts[section].heading;
  const [issues, setIssues] = useState<BlockIssue[]>([]);
  const first = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  const prompt = prompts[section];
  const issue = (field: BlockIssue['field']) =>
    issues.find((item) => item.field === field)?.message;
  const patch = (changes: Partial<EditBlock>) => {
    setBlock((current) => ({ ...current, ...changes }));
    if (issues.length) setIssues([]);
  };
  const allowPhotos = section === 'community' || section === 'portrait';
  function addPhotos(files: FileList | null) {
    if (!files) return;
    const chosen = [...files];
    if (block.photos.length + chosen.length > MAX_BLOCK_PHOTOS) {
      setIssues([{ field: 'photos', message: `Use at most ${MAX_BLOCK_PHOTOS} photographs.` }]);
      return;
    }
    const invalid = chosen.find(
      (file) =>
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 10 * 1024 * 1024,
    );
    if (invalid) {
      setIssues([
        { field: 'photos', message: `${invalid.name}: use JPEG, PNG, or WebP of 10 MB or less.` },
      ]);
      return;
    }
    patch({
      photos: [
        ...block.photos,
        ...chosen.map(
          (file): EditPhotoDraft => ({
            clientPhotoId: crypto.randomUUID(),
            file,
            name: file.name,
            preview: URL.createObjectURL(file),
            metadata: { caption: '', creator: '', rights: '', permission: false },
          }),
        ),
      ],
    });
  }
  function updatePhoto(index: number, changes: Partial<EditPhotoDraft['metadata']>) {
    patch({
      photos: block.photos.map((photo, i) =>
        i === index ? { ...photo, metadata: { ...photo.metadata, ...changes } } : photo,
      ),
    });
  }
  function removePhoto(index: number) {
    const photo = block.photos[index];
    if (photo?.file) URL.revokeObjectURL(photo.preview);
    patch({ photos: block.photos.filter((_, i) => i !== index) });
  }
  function save() {
    const found = validateBlock(block);
    if (found.length) {
      setIssues(found);
      return;
    }
    onSave(block);
  }
  return (
    <form
      className="person-edit-form"
      aria-label={heading}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      noValidate
    >
      <div className="person-edit-form-head">
        <strong>{heading}</strong>
        <button type="button" className="community-text-button" onClick={onCancel}>
          <X size={15} aria-hidden="true" /> Cancel
        </button>
      </div>
      {placeEdit && (
        <div className={`community-field ${issue('place') ? 'has-error' : ''}`}>
          <label className="community-field">
            <span>
              Place name <span className="community-required">*</span>
            </span>
            <input
              value={block.proposedPlaceName}
              onChange={(event) => patch({ proposedPlaceName: event.target.value })}
              maxLength={160}
            />
          </label>
          <label className="community-field">
            <span>
              About this place <span className="community-hint">(optional)</span>
            </span>
            <textarea
              value={block.placeSummary ?? ''}
              rows={3}
              maxLength={4000}
              placeholder="What this place is, for anyone who finds it on the map."
              onChange={(event) => patch({ placeSummary: event.target.value })}
            />
          </label>
          <LocationPicker
            label="Move the pin if the position is wrong"
            hint="Drag the pin, tap a new spot, or search an address. Leave it where it is if only the text needs changing."
            value={
              block.coordinates
                ? { coordinates: block.coordinates, scope: block.scope ?? 'cemetery' }
                : null
            }
            onChange={(picked) =>
              patch({ coordinates: picked?.coordinates ?? null, scope: picked?.scope })
            }
          />
          {issue('place') && (
            <small className="community-field-error" role="alert">
              {issue('place')}
            </small>
          )}
        </div>
      )}
      {section === 'places' && !placeEdit && (
        <div className={`community-field ${issue('place') ? 'has-error' : ''}`}>
          <RecordPicker
            label="Which place?"
            options={places}
            value={block.placeIds}
            onChange={(ids) => patch({ placeIds: ids.slice(0, 1) })}
            placeholder="Search places on the map…"
          />
          <label className="community-field" style={{ marginTop: 8 }}>
            <span>
              Or name a place not on the map yet <span className="community-hint">(optional)</span>
            </span>
            <input
              value={block.proposedPlaceName}
              onChange={(event) => patch({ proposedPlaceName: event.target.value })}
              maxLength={160}
              placeholder="Wheat Street Baptist Church, Atlanta"
            />
          </label>
          {issue('place') && (
            <small className="community-field-error" role="alert">
              {issue('place')}
            </small>
          )}
          {!block.placeIds.length && (
            <label className="community-field">
              <span>
                About this place <span className="community-hint">(optional)</span>
              </span>
              <textarea
                value={block.placeSummary ?? ''}
                rows={3}
                maxLength={4000}
                placeholder="What this place is, for anyone who finds it on the map."
                onChange={(event) => patch({ placeSummary: event.target.value })}
              />
            </label>
          )}
          {!block.placeIds.length && (
            <LocationPicker
              value={
                block.coordinates
                  ? { coordinates: block.coordinates, scope: block.scope ?? 'cemetery' }
                  : null
              }
              onChange={(picked) =>
                patch({ coordinates: picked?.coordinates ?? null, scope: picked?.scope })
              }
            />
          )}
        </div>
      )}
      {allowPhotos && (
        <div className={`community-field ${issue('photos') ? 'has-error' : ''}`}>
          <span>
            Photographs{' '}
            <span className="community-hint">
              {section === 'portrait' ? '*' : '(optional, up to five)'}
            </span>
          </span>
          <label className="person-edit-upload">
            <ImagePlus size={18} aria-hidden="true" /> Choose photographs
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple={section !== 'portrait'}
              onChange={(event) => {
                addPhotos(event.target.files);
                event.target.value = '';
              }}
              disabled={block.photos.length >= MAX_BLOCK_PHOTOS}
            />
          </label>
          {block.hadPhotos && !block.photos.length && (
            <small className="community-hint">
              Photographs from your earlier draft could not be restored; choose them again.
            </small>
          )}
          {block.photos.map((photo, index) => (
            <div className="person-edit-photo" key={photo.clientPhotoId}>
              <img src={photo.preview} alt="" />
              <div className="community-fields" style={{ gap: 8 }}>
                <label className="community-field">
                  <span>Caption *</span>
                  <input
                    value={photo.metadata.caption}
                    maxLength={500}
                    placeholder="The Hill family at the South-View gate, about 1960"
                    onChange={(event) => updatePhoto(index, { caption: event.target.value })}
                  />
                </label>
                <label className="community-field">
                  <span>Photographer or creator *</span>
                  <input
                    value={photo.metadata.creator}
                    maxLength={160}
                    placeholder="Ruth Hill, or “family collection”, or “unknown”"
                    onChange={(event) => updatePhoto(index, { creator: event.target.value })}
                  />
                </label>
                <label className="community-field">
                  <span>Rights and permission *</span>
                  <input
                    value={photo.metadata.rights}
                    maxLength={1000}
                    placeholder="Owned by our family; South-View may display it online"
                    onChange={(event) => updatePhoto(index, { rights: event.target.value })}
                  />
                </label>
                <label className="community-check">
                  <input
                    type="checkbox"
                    checked={photo.metadata.permission}
                    onChange={(event) => updatePhoto(index, { permission: event.target.checked })}
                  />
                  <span>I have permission for South-View to display this photograph.</span>
                </label>
                <button
                  type="button"
                  className="community-text-button"
                  onClick={() => removePhoto(index)}
                >
                  <Trash2 size={14} aria-hidden="true" /> Remove
                </button>
              </div>
            </div>
          ))}
          {issue('photos') && (
            <small className="community-field-error" role="alert">
              {issue('photos')}
            </small>
          )}
        </div>
      )}
      <label className={`community-field ${issue('body') ? 'has-error' : ''}`}>
        <span>
          {placeEdit
            ? 'How this place was part of their life, as it should read'
            : correction
              ? 'The paragraph, as you would like it to read'
              : prompt.body}{' '}
          <span className="community-required">*</span>
        </span>
        <textarea
          ref={first}
          value={block.body}
          rows={section === 'biography' ? 6 : 4}
          maxLength={20000}
          onChange={(event) => patch({ body: event.target.value })}
        />
        {issue('body') && (
          <small className="community-field-error" role="alert">
            {issue('body')}
          </small>
        )}
        <small>
          {placeEdit
            ? 'Fix the name, the position, or the description. Reviewers see what changed and can apply it with one click.'
            : correction
              ? 'Change the text directly. Reviewers see your version beside the current one and can apply it with one click.'
              : prompt.bodyHint}
        </small>
      </label>
      {prompt.context && (
        <label className="community-field">
          <span>
            {correction ? 'What changed, and how do you know?' : prompt.context}{' '}
            <span className="community-hint">(optional)</span>
          </span>
          <input
            value={block.context}
            maxLength={4000}
            onChange={(event) => patch({ context: event.target.value })}
            placeholder="She was my great-aunt; my mother told me this at family reunions."
          />
        </label>
      )}
      <label className={`community-field ${issue('title') ? 'has-error' : ''}`} htmlFor={`${id}-t`}>
        <span>
          Short title <span className="community-hint">(optional)</span>
        </span>
        <input
          id={`${id}-t`}
          value={block.title}
          maxLength={160}
          onChange={(event) => patch({ title: event.target.value })}
          placeholder={defaultBlockTitle(block, personName)}
        />
        {issue('title') && (
          <small className="community-field-error" role="alert">
            {issue('title')}
          </small>
        )}
      </label>
      <div className="community-actions" style={{ marginTop: 4 }}>
        <button className="community-primary" type="submit">
          {initial ? 'Save changes' : correction ? 'Keep this edit' : 'Add to page'}{' '}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}
