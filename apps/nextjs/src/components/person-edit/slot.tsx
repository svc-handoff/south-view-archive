'use client';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { copy } from '@/lib/copy';
import { sectionLabel, type EditBlock, type EditKind, type EditSection } from '@/lib/person-edit';
import { InlineForm, type ExistingPlace } from './inline-form';
import { sameSlot, usePersonEdit } from './context';

/**
 * A place on the person page where a visitor can add something. Renders nothing outside edit
 * mode, dashed add buttons or the inline form while editing, and awaiting-review blocks in
 * preview. Blocks are matched to a slot by section plus anchor.
 */
export function AddSlot({
  section,
  anchor,
  original,
  place,
  addLabel,
  correctionLabel,
}: {
  section: EditSection;
  anchor?: string;
  /** The biography paragraph this slot follows, offered for in-place editing. */
  original?: string;
  /** An existing place relationship this slot edits instead of adding a new place. */
  place?: ExistingPlace;
  addLabel?: string;
  correctionLabel?: string;
}) {
  const edit = usePersonEdit();
  if (!edit.editing) return null;
  const slot = { section, anchor };
  const here = edit.blocks.filter(
    (block) => block.section === section && (block.anchor ?? '') === (anchor ?? ''),
  );
  const active = sameSlot(edit.activeSlot, slot);
  const editingBlock = active ? here.find((block) => block.id === edit.editingBlockId) : undefined;
  const defaultKind: EditKind = section === 'community' ? 'memory' : 'addition';
  const labels = {
    add:
      addLabel ??
      {
        biography: 'Add a paragraph here',
        places: 'Add a place',
        community: 'Add a memory or photograph',
        portrait: 'Add a photograph',
      }[section],
    correction: correctionLabel ?? copy.editParagraph,
  };
  return (
    <div className="person-edit-slot" data-section={section}>
      {here.map((block) =>
        editingBlock?.id === block.id ? null : <DraftBlock key={block.id} block={block} />,
      )}
      {active && edit.phase === 'edit' && (
        <InlineForm
          key={editingBlock?.id ?? `${section}-${anchor ?? ''}`}
          section={section}
          kind={editingBlock?.kind ?? edit.activeKind}
          anchor={anchor}
          original={original}
          place={place}
          initial={editingBlock}
          personName={edit.person.name}
          places={edit.places}
          onSave={edit.saveBlock}
          onCancel={edit.closeSlot}
        />
      )}
      {!active && edit.phase === 'edit' && place && (
        <div className="person-edit-actions" role="group" aria-label={place.name}>
          <button
            type="button"
            className="person-edit-add"
            onClick={() => edit.openSlot(slot, 'correction')}
          >
            <Pencil size={14} aria-hidden="true" /> Edit this place
          </button>
        </div>
      )}
      {!active && edit.phase === 'edit' && !place && (
        <div className="person-edit-actions" role="group" aria-label={sectionLabel(section)}>
          <button
            type="button"
            className="person-edit-add"
            onClick={() => edit.openSlot(slot, defaultKind)}
          >
            <Plus size={15} aria-hidden="true" /> {labels.add}
          </button>
          {section === 'biography' && anchor && anchor !== 'start' && original && (
            <button
              type="button"
              className="person-edit-add"
              onClick={() => edit.openSlot(slot, 'correction')}
            >
              <Pencil size={14} aria-hidden="true" /> {labels.correction}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DraftBlock({ block }: { block: EditBlock }) {
  const edit = usePersonEdit();
  const preview = edit.phase === 'preview';
  return (
    <article
      className={`person-edit-block ${preview ? 'is-preview' : ''}`}
      aria-label={preview ? copy.awaitingReview : 'Your unsent addition'}
    >
      <p className="person-edit-block-label">
        {preview
          ? copy.awaitingReview
          : block.kind === 'correction'
            ? block.section === 'places'
              ? 'Edited place · not sent yet'
              : 'Edited paragraph · not sent yet'
            : 'Addition · not sent yet'}
      </p>
      {block.proposedPlaceName && <strong>{block.proposedPlaceName}</strong>}
      {block.placeIds.map((id) => {
        const place = edit.places.find((item) => item.id === id);
        return place ? <strong key={id}>{place.name}</strong> : null;
      })}
      {block.title && <h3>{block.title}</h3>}
      <p className="person-edit-block-body">{block.body}</p>
      {block.photos.length > 0 && (
        <div className="person-edit-block-photos">
          {block.photos.map((photo) => (
            <figure key={photo.clientPhotoId}>
              <img src={photo.preview} alt={photo.metadata.caption} />
              <figcaption>{photo.metadata.caption}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {block.context && (
        <p className="person-edit-block-context">
          <span>How they know:</span> {block.context}
        </p>
      )}
      {!preview && (
        <div className="person-edit-block-actions">
          <button
            type="button"
            className="community-text-button"
            onClick={() => edit.editBlock(block.id)}
          >
            <Pencil size={14} aria-hidden="true" /> Edit
          </button>
          <button
            type="button"
            className="community-text-button"
            onClick={() => edit.removeBlock(block.id)}
          >
            <Trash2 size={14} aria-hidden="true" /> Remove
          </button>
        </div>
      )}
    </article>
  );
}
