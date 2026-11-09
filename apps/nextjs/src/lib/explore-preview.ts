import { scopeIncludesPlace, type ArchiveData, type Scope } from '@southview/validators';

export type PreviewTarget = {
  personId: string;
  placeId?: string;
  anchor: HTMLElement;
  input: 'pointer' | 'keyboard';
};

export function previewSelection(
  archive: ArchiveData,
  scope: Scope,
  target: Pick<PreviewTarget, 'personId' | 'placeId'>,
) {
  if (!archive.people.some((person) => person.id === target.personId)) return null;
  const available = archive.relations.filter(
    (relation) =>
      relation.personId === target.personId &&
      archive.places.some(
        (place) => place.id === relation.placeId && scopeIncludesPlace(scope, place.scope),
      ),
  );
  if (target.placeId && !available.some((relation) => relation.placeId === target.placeId))
    return null;
  const preferred =
    available.find((relation) =>
      archive.places.some((place) => place.id === relation.placeId && place.scope === scope),
    ) ?? available[0];
  return { person: target.personId, place: target.placeId ?? preferred?.placeId ?? null };
}

// Briefly debounce small preview cards. Open drawers and keyboard focus can
// bypass this delay so moving between records feels immediate.
export function createPreviewController<T>(commit: (target: T | null) => void, delay = 60) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    show(target: T, immediate = false) {
      cancel();
      if (immediate) commit(target);
      else
        timer = setTimeout(() => {
          timer = undefined;
          commit(target);
        }, delay);
    },
    clear() {
      cancel();
      commit(null);
    },
    cancel,
  };
}

// Remember an entered marker during camera motion. Browsers do not send a
// second pointerenter when the camera stops beneath an already-stationary mouse.
export function createMarkerHoverController<T extends { anchor: unknown }>(
  commit: (target: T | null) => void,
) {
  let active: T | null = null;
  let moving = false;
  const clear = () => {
    active = null;
    commit(null);
  };
  return {
    enter(target: T) {
      active = target;
      if (!moving) commit(target);
    },
    leave(anchor: T['anchor']) {
      if (active?.anchor === anchor) clear();
    },
    startMove() {
      moving = true;
      commit(null);
    },
    endMove(isStillHovered: (target: T) => boolean) {
      moving = false;
      if (!active) return;
      if (isStillHovered(active)) commit(active);
      else clear();
    },
    clear,
  };
}

type Rect = { left: number; right: number; top: number; bottom: number };

export function previewPosition(
  anchor: Rect,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  obstacles: Rect[] = [],
) {
  const gap = 12;
  const x = (anchor.left + anchor.right - card.width) / 2;
  const y = (anchor.top + anchor.bottom - card.height) / 2;
  const candidates = [
    { left: anchor.right + gap, top: y },
    { left: anchor.left - gap - card.width, top: y },
    { left: x, top: anchor.top - gap - card.height },
    { left: x, top: anchor.bottom + gap },
  ];
  const overlap = (a: Rect, b: Rect) =>
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
    Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return candidates
    .map((candidate) => {
      const left = Math.max(gap, Math.min(candidate.left, viewport.width - card.width - gap));
      const top = Math.max(76, Math.min(candidate.top, viewport.height - card.height - 36));
      const rect = { left, top, right: left + card.width, bottom: top + card.height };
      return {
        left,
        top,
        overlap: [anchor, ...obstacles].reduce(
          (area, obstacle) => area + overlap(rect, obstacle),
          0,
        ),
      };
    })
    .sort((a, b) => a.overlap - b.overlap)[0]!;
}
