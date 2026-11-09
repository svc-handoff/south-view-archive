'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { Person, Place } from '@southview/validators';
import { previewPosition, type PreviewTarget } from '@/lib/explore-preview';
import { peopleLine } from '@/lib/people-line';
import { displayPersonName } from '@/lib/person-name';

export function MapPreview({
  target,
  person,
  place,
  people = [],
}: {
  target: PreviewTarget;
  person: Person;
  place?: Place;
  /** Everyone connected to the hovered place, when the preview is for a marker. */
  people?: string[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const positionCard = () => {
      const sidebar = document.querySelector('.people-sidebar')?.getBoundingClientRect();
      const next = previewPosition(
        target.anchor.getBoundingClientRect(),
        card.getBoundingClientRect(),
        { width: window.innerWidth, height: window.innerHeight },
        sidebar ? [sidebar] : [],
      );
      setPosition((previous) =>
        previous?.left === next.left && previous?.top === next.top ? previous : next,
      );
    };
    positionCard();
    const observer = new ResizeObserver(positionCard);
    observer.observe(card);
    const describedBy = target.anchor.getAttribute('aria-describedby');
    target.anchor.setAttribute('aria-describedby', [describedBy, id].filter(Boolean).join(' '));
    return () => {
      observer.disconnect();
      if (describedBy) target.anchor.setAttribute('aria-describedby', describedBy);
      else target.anchor.removeAttribute('aria-describedby');
    };
  }, [target, id]);
  return (
    <div
      ref={ref}
      id={id}
      className="hover-preview"
      role="tooltip"
      style={{
        left: position?.left,
        top: position?.top,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {place ? (
        <>
          <h3>{place.name}</h3>
          <span className="preview-place">
            {place.scope === 'cemetery' ? 'Grave marker' : 'Place'}
            {people.length ? ` · ${peopleLine(people)}` : ''}
          </span>
          <p>{place.summary || person.summary}</p>
        </>
      ) : (
        <>
          <h3>{displayPersonName(person.name)}</h3>
          <p>{person.summary}</p>
        </>
      )}
    </div>
  );
}
