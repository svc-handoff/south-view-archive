'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ArrowLeft, ArrowRight, Expand, ExternalLink, ImageOff, X } from 'lucide-react';
import './photo-viewer.css';

export type PhotoViewerItem = {
  /** Stable within the page. The thumbnail is linkable at #photo-{id}. */
  id: string;
  src: string;
  thumbnailSrc?: string;
  alt: string;
  caption: string;
  creator: string;
  provider: string;
  rights: string;
  width?: number;
  height?: number;
  source?: { href: string; label: string };
  entry?: { href: string; label: string };
};

export type PhotoViewerProps = {
  items: PhotoViewerItem[];
  label?: string;
  variant?: 'gallery' | 'portrait';
  /** Render one thumbnail while preserving the complete dialog sequence. */
  onlyThumbnailId?: string;
};

function PhotoAttribution({ item, headingId }: { item: PhotoViewerItem; headingId?: string }) {
  return (
    <div className="photo-attribution">
      {headingId ? (
        <h2 id={headingId}>{item.caption}</h2>
      ) : (
        <strong className="photo-caption">{item.caption}</strong>
      )}
      <dl>
        <div>
          <dt>Creator</dt>
          <dd>{item.creator}</dd>
        </div>
        <div>
          <dt>Provider</dt>
          <dd>
            {item.provider} — {item.caption}
          </dd>
        </div>
        <div>
          <dt>Rights</dt>
          <dd>{item.rights}</dd>
        </div>
      </dl>
      {(item.source || item.entry) && (
        <div className="photo-attribution-links">
          {item.source && (
            <a
              href={item.source.href}
              target={/^https?:\/\//i.test(item.source.href) ? '_blank' : undefined}
              rel="noopener noreferrer"
            >
              {item.source.label}
              <ExternalLink size={14} aria-hidden="true" />
              {/^https?:\/\//i.test(item.source.href) && (
                <span className="sr-only"> (opens in a new tab)</span>
              )}
            </a>
          )}
          {item.entry && (
            <a href={item.entry.href}>
              {item.entry.label}
              <ArrowRight size={14} aria-hidden="true" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function PhotoViewer({
  items,
  label = 'Photographs',
  variant = 'gallery',
  onlyThumbnailId,
}: PhotoViewerProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  const [viewerError, setViewerError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const thumbnailRefs = useRef(new Map<string, HTMLButtonElement>());
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const headingId = useId();
  const instructionsId = useId();
  const active = items[activeIndex] ?? items[0];
  const thumbnails = onlyThumbnailId ? items.filter((item) => item.id === onlyThumbnailId) : items;

  useEffect(() => {
    const showHashPhoto = (event?: HashChangeEvent) => {
      let hash = '';
      try {
        hash = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      const index = items.findIndex((item) => `photo-${item.id}` === hash);
      const item = items[index];
      if (!item || (onlyThumbnailId && item.id !== onlyThumbnailId)) {
        // Moving to another fragment also closes a directly linked photograph.
        if (event) setIsOpen(false);
        return;
      }
      returnFocus.current = thumbnailRefs.current.get(item.id) ?? null;
      setActiveIndex(index);
      setIsOpen(true);
    };
    showHashPhoto();
    window.addEventListener('hashchange', showHashPhoto);
    return () => window.removeEventListener('hashchange', showHashPhoto);
  }, [items, onlyThumbnailId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;
    if (typeof dialog.showModal !== 'function') {
      setViewerError(
        'This browser cannot open the enlarged view. The photograph details and original links remain available below.',
      );
      setIsOpen(false);
      return;
    }
    const previousOverflow = document.body.style.overflow;
    try {
      if (!dialog.open) dialog.showModal();
    } catch {
      setViewerError(
        'The enlarged view could not be opened. The photograph details and original links remain available below.',
      );
      setIsOpen(false);
      return;
    }
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    };
  }, [isOpen]);

  useEffect(() => {
    if (activeIndex >= items.length) setActiveIndex(0);
  }, [items.length, activeIndex]);

  function markFailed(id: string, kind: 'thumbnail' | 'full') {
    setFailedImages((previous) => new Set(previous).add(`${kind}:${id}`));
  }
  function navigate(direction: number) {
    if (items.length > 1)
      setActiveIndex((previous) => (previous + direction + items.length) % items.length);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || !isOpen) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      navigate(1);
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      navigate(-1);
    }
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'mouse') touchStart.current = { x: event.clientX, y: event.clientY };
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const horizontal = event.clientX - start.x,
      vertical = event.clientY - start.y;
    if (Math.abs(horizontal) > 65 && Math.abs(vertical) < 45) navigate(horizontal < 0 ? 1 : -1);
  }

  if (!active || thumbnails.length === 0) return null;
  return (
    <div className={`photo-viewer photo-viewer-${variant}`} aria-label={label}>
      {viewerError && (
        <p className="photo-viewer-notice" role="status">
          {viewerError}
        </p>
      )}
      <div className="photo-viewer-thumbnails">
        {thumbnails.map((item) => (
          <figure className="photo-viewer-figure" id={`photo-${item.id}`} key={item.id}>
            <button
              className="photo-viewer-trigger"
              type="button"
              ref={(node) => {
                if (node) thumbnailRefs.current.set(item.id, node);
                else thumbnailRefs.current.delete(item.id);
              }}
              aria-haspopup="dialog"
              aria-label={`Enlarge photograph: ${item.caption}`}
              onClick={(event) => {
                returnFocus.current = event.currentTarget;
                setActiveIndex(items.findIndex((photo) => photo.id === item.id));
                setViewerError('');
                setIsOpen(true);
              }}
            >
              {failedImages.has(`thumbnail:${item.id}`) ? (
                <span className="photo-image-unavailable">
                  <ImageOff size={30} aria-hidden="true" />
                  <span>Photograph unavailable</span>
                  <small>Open its details</small>
                </span>
              ) : (
                <img
                  src={item.thumbnailSrc ?? item.src}
                  alt={item.alt}
                  width={item.width}
                  height={item.height}
                  loading="lazy"
                  onError={() => markFailed(item.id, 'thumbnail')}
                />
              )}
              <span className="photo-enlarge-label">
                <Expand size={15} aria-hidden="true" /> Enlarge photograph
              </span>
            </button>
            <figcaption>
              <PhotoAttribution item={item} />
            </figcaption>
          </figure>
        ))}
      </div>

      <dialog
        className="photo-viewer-dialog"
        ref={dialogRef}
        aria-labelledby={headingId}
        aria-describedby={instructionsId}
        onKeyDown={onKeyDown}
        onCancel={(event) => {
          event.preventDefault();
          setIsOpen(false);
        }}
        onClose={() => setIsOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              setIsOpen(false);
          }
        }}
      >
        <div className="photo-dialog-toolbar">
          <p className="photo-dialog-count" aria-live="polite" aria-atomic="true">
            Photograph {Math.min(activeIndex + 1, items.length)} of {items.length}
          </p>
          <div className="photo-dialog-actions">
            <button
              type="button"
              aria-label="Previous photograph"
              onClick={() => navigate(-1)}
              disabled={items.length < 2}
            >
              <ArrowLeft size={21} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Next photograph"
              onClick={() => navigate(1)}
              disabled={items.length < 2}
            >
              <ArrowRight size={21} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="photo-dialog-close"
              ref={closeRef}
              onClick={() => setIsOpen(false)}
              aria-label="Close enlarged photograph"
            >
              <X size={22} aria-hidden="true" />
              <span>Close</span>
            </button>
          </div>
        </div>
        <div className="photo-dialog-content">
          <div
            className="photo-dialog-image"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              touchStart.current = null;
            }}
          >
            {failedImages.has(`full:${active.id}`) ? (
              <div className="photo-image-unavailable" role="status">
                <ImageOff size={38} aria-hidden="true" />
                <p>This photograph could not be loaded.</p>
                <p>Its attribution and source links are still available.</p>
                <a href={active.src} target="_blank" rel="noopener noreferrer">
                  Try opening the image file <ExternalLink size={14} aria-hidden="true" />
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </div>
            ) : (
              <img
                key={active.id}
                src={active.src}
                alt={active.alt}
                width={active.width}
                height={active.height}
                onError={() => markFailed(active.id, 'full')}
              />
            )}
          </div>
          <div className="photo-dialog-details">
            <PhotoAttribution item={active} headingId={headingId} />
            <p className="photo-dialog-help" id={instructionsId}>
              {items.length > 1
                ? 'Use the arrow buttons or left and right arrow keys to move between photographs. '
                : ''}
              Press Escape to close.
            </p>
          </div>
        </div>
      </dialog>
    </div>
  );
}
