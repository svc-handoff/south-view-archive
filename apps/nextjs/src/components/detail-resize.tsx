'use client';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

type Size = { width?: number; height?: number };
type Options = {
  /** Where the size is remembered in this browser. */
  storageKey: string;
  /** CSS variables set on the explorer, so other map controls can keep clear of the panel. */
  widthVar: string;
  heightVar?: string;
  /** The edge that is dragged on a desktop: the panel grows away from it. */
  edge: 'left' | 'right';
  /** Widest the panel may get, as a share of the window, and never above `maxWidth`. */
  maxShare: number;
  maxWidth: number;
  minWidth: number;
  label: string;
  className: string;
};

const phone = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
const clamp = (value: number, range: { min: number; max: number }) =>
  Math.round(Math.min(range.max, Math.max(range.min, value)));
const heightRange = (viewport: number) => ({ min: 260, max: Math.round(viewport * 0.92) });

/**
 * Lets a map panel be dragged wider on a desktop (and, with `heightVar`, taller on a phone). The
 * size is exposed as CSS variables on the explorer and remembered per browser.
 */
function usePanelResize(options: Options) {
  const { storageKey, widthVar, heightVar, edge, maxShare, maxWidth, minWidth } = options;
  const [size, setSize] = useState<Size>({});
  const [resizing, setResizing] = useState(false);
  const start = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const widthRange = useCallback(
    (viewport: number) => ({
      min: minWidth,
      max: Math.max(minWidth + 20, Math.min(maxWidth, viewport * maxShare)),
    }),
    [maxShare, maxWidth, minWidth],
  );
  // Dragging the left edge leftwards widens the panel; the right edge, rightwards.
  const direction = edge === 'left' ? -1 : 1;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Size | null;
      if (saved && typeof saved === 'object')
        setSize({
          width: typeof saved.width === 'number' ? saved.width : undefined,
          height: heightVar && typeof saved.height === 'number' ? saved.height : undefined,
        });
    } catch {
      /* A default size is fine. */
    }
  }, [storageKey, heightVar]);
  const remember = useCallback(
    (value: Size) => {
      const next: Size = {
        ...(value.width ? { width: value.width } : {}),
        ...(value.height ? { height: value.height } : {}),
      };
      setSize(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* The size then lasts for this page view only. */
      }
    },
    [storageKey],
  );
  const resizesHeight = () => !!heightVar && phone();

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const element = panel.current ?? (event.currentTarget.parentElement as HTMLElement | null);
    if (!element) return;
    panel.current = element;
    const box = element.getBoundingClientRect();
    start.current = { x: event.clientX, y: event.clientY, width: box.width, height: box.height };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic or released pointers cannot be captured; dragging still works. */
    }
    setResizing(true);
    event.preventDefault();
  }, []);
  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const origin = start.current;
      if (!origin) return;
      if (resizesHeight())
        setSize((current) => ({
          ...current,
          height: clamp(
            origin.height + (origin.y - event.clientY),
            heightRange(window.innerHeight),
          ),
        }));
      else
        setSize((current) => ({
          ...current,
          width: clamp(
            origin.width + direction * (event.clientX - origin.x),
            widthRange(window.innerWidth),
          ),
        }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [direction, widthRange],
  );
  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!start.current) return;
      start.current = null;
      setResizing(false);
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        /* Capture may already be gone. */
      }
      setSize((current) => {
        remember(current);
        return current;
      });
    },
    [remember],
  );
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = 24;
      const element = event.currentTarget.parentElement;
      if (!element) return;
      const box = element.getBoundingClientRect();
      if (resizesHeight()) {
        const delta = event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0;
        if (!delta) return;
        event.preventDefault();
        remember({ ...size, height: clamp(box.height + delta, heightRange(window.innerHeight)) });
      } else {
        const toward = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!toward) return;
        event.preventDefault();
        remember({
          ...size,
          width: clamp(box.width + toward * direction * step, widthRange(window.innerWidth)),
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [remember, size, direction, widthRange],
  );

  const style = {
    ...(size.width ? { [widthVar]: `${size.width}px` } : {}),
    ...(heightVar && size.height ? { [heightVar]: `${size.height}px` } : {}),
  } as CSSProperties;
  const handle = (
    <div
      className={options.className}
      role="separator"
      aria-label={`${options.label} Drag, or use the arrow keys.`}
      aria-orientation={resizesHeight() ? 'horizontal' : 'vertical'}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
    />
  );
  const panelClass = `${size.height ? 'is-resized' : ''} ${resizing ? 'is-resizing' : ''}`.trim();
  return { style, handle, panelClass };
}

/** The person panel on the right: its left edge on a desktop, a grab bar on a phone. */
export const useDetailResize = () =>
  usePanelResize({
    storageKey: 'south-view-detail-size',
    widthVar: '--detail-width',
    heightVar: '--detail-height',
    edge: 'left',
    minWidth: 300,
    maxWidth: 760,
    maxShare: 0.65,
    label: 'Resize the person panel.',
    className: 'detail-resize',
  });

/** The search and people list on the left: its right edge, on a desktop only. */
export const useSidebarResize = () =>
  usePanelResize({
    storageKey: 'south-view-sidebar-size',
    widthVar: '--sidebar-width',
    edge: 'right',
    minWidth: 280,
    maxWidth: 620,
    maxShare: 0.4,
    label: 'Resize the search panel.',
    className: 'detail-resize sidebar-resize',
  });
