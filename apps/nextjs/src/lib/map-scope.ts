import { scopeIncludesPlace, type ArchiveData, type Scope } from '@southview/validators';
import { cemeteryBounds } from './cemetery-area';
import type { ExploreState, Viewport } from './explore-state';

// Separate thresholds avoid flickering between views while zooming near the boundary.
export function scopeForViewport(scope: Scope, viewport: Viewport): Scope {
  if (viewport.zoom <= 14) return 'atlanta';
  const nearCemetery =
    viewport.lng >= cemeteryBounds[0][0] - 0.003 &&
    viewport.lng <= cemeteryBounds[1][0] + 0.003 &&
    viewport.lat >= cemeteryBounds[0][1] - 0.003 &&
    viewport.lat <= cemeteryBounds[1][1] + 0.003;
  return viewport.zoom >= 15 && nearCemetery ? 'cemetery' : scope;
}

export function viewportState(
  state: ExploreState,
  viewport: Viewport,
  autoScope: boolean,
  archive: Pick<ArchiveData, 'places' | 'relations'>,
): ExploreState {
  const scope = autoScope ? scopeForViewport(state.scope, viewport) : state.scope;
  if (scope === state.scope) return { ...state, viewport };
  const relations = archive.relations.filter(
    (r) =>
      r.personId === state.person &&
      archive.places.some((p) => p.id === r.placeId && scopeIncludesPlace(scope, p.scope)),
  );
  const place = relations.some((r) => r.placeId === state.place)
    ? state.place
    : (relations[0]?.placeId ?? null);
  return { ...state, scope, place, viewport };
}
