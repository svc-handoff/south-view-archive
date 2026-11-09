import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureArchive } from '../packages/db/src/fixtures';
import {
  cemeteryBounds,
  cemeteryCenter,
  overviewBounds,
} from '../apps/nextjs/src/lib/cemetery-area';
import {
  initialExploreState,
  parseExploreState,
  serializeExploreState,
} from '../apps/nextjs/src/lib/explore-state';
import { scopeForViewport, viewportState } from '../apps/nextjs/src/lib/map-scope';

const close = { lng: cemeteryCenter[0], lat: cemeteryCenter[1], zoom: 16 };
const far = { ...close, zoom: 13 };

test('zooming out widens the view without changing camera, filters, selection or embed state', () => {
  const state = {
    ...initialExploreState,
    q: 'Lewis',
    theme: 'Civil Rights',
    person: 'john-lewis',
    place: 'lewis-south-view',
    embed: true,
    viewport: close,
  };
  const next = viewportState(state, far, true, fixtureArchive);
  assert.deepEqual(next, { ...state, scope: 'atlanta', viewport: far });
  assert.deepEqual(
    parseExploreState(new URL(serializeExploreState(next), 'https://example.org').search),
    {
      ...next,
      viewport: {
        lng: Number(far.lng.toFixed(5)),
        lat: Number(far.lat.toFixed(5)),
        zoom: far.zoom,
      },
    },
  );
});

test('threshold hysteresis and cemetery proximity prevent scope flicker or switching at city landmarks', () => {
  assert.equal(scopeForViewport('cemetery', { ...close, zoom: 14.3 }), 'cemetery');
  assert.equal(scopeForViewport('atlanta', { ...close, zoom: 14.7 }), 'atlanta');
  assert.equal(scopeForViewport('cemetery', { ...close, zoom: 14 }), 'atlanta');
  assert.equal(scopeForViewport('atlanta', { ...close, zoom: 15 }), 'cemetery');
  assert.equal(scopeForViewport('atlanta', { lng: -84.39058, lat: 33.74862, zoom: 17 }), 'atlanta');
});

test('explicit overview, resize and URL restoration never override a manually selected scope', () => {
  assert.equal(viewportState(initialExploreState, far, false, fixtureArchive).scope, 'cemetery');
  assert.equal(
    viewportState({ ...initialExploreState, scope: 'atlanta' }, close, false, fixtureArchive).scope,
    'atlanta',
  );
});

test('returning to cemetery scope preserves the person and selects their cemetery relationship', () => {
  const next = viewportState(
    { ...initialExploreState, scope: 'atlanta', person: 'john-lewis', place: 'atlanta-city-hall' },
    close,
    true,
    fixtureArchive,
  );
  assert.equal(next.scope, 'cemetery');
  assert.equal(next.person, 'john-lewis');
  assert.equal(next.place, 'lewis-south-view');
  assert.equal(next.viewport, close);
  const missing = viewportState(
    { ...initialExploreState, scope: 'atlanta', person: 'no-location', place: 'unknown' },
    close,
    true,
    fixtureArchive,
  );
  assert.equal(missing.person, 'no-location');
  assert.equal(missing.place, null);
});

test('the explicit Atlanta overview frames both cemetery boundaries and every mapped city place', () => {
  const bounds = overviewBounds(fixtureArchive.places, 'atlanta');
  for (const [lng, lat] of [
    ...cemeteryBounds,
    ...fixtureArchive.places.flatMap((p) => (p.coordinates ? [p.coordinates] : [])),
  ]) {
    assert.ok(lng >= bounds[0][0] && lng <= bounds[1][0]);
    assert.ok(lat >= bounds[0][1] && lat <= bounds[1][1]);
  }
  assert.deepEqual(overviewBounds([], 'atlanta'), cemeteryBounds);
  assert.deepEqual(overviewBounds(fixtureArchive.places, 'cemetery'), cemeteryBounds);
});
