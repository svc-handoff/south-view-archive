import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initialExploreState,
  parseExploreState,
  serializeExploreState,
  type ExploreState,
} from '../apps/nextjs/src/lib/explore-state';

const origin = 'https://archive.example.org';

function readState(href: string) {
  return parseExploreState(new URL(href, origin).search);
}

test('a shareable URL restores filters, selection, scope, and a useful map viewport', () => {
  const state: ExploreState = {
    scope: 'atlanta',
    q: 'King & family / Atlanta + 学校?',
    theme: 'Faith & Community',
    person: 'martin-luther-king-sr',
    place: 'ebenezer-heritage',
    panel: 'person',
    embed: false,
    viewport: { lng: -84.374046, lat: 33.755268, zoom: 14.567 },
  };
  const href = serializeExploreState(state);
  const restored = readState(href);

  assert.equal(new URL(href, origin).pathname, '/explore');
  assert.equal(restored.q, state.q);
  assert.equal(restored.theme, state.theme);
  assert.equal(restored.scope, 'atlanta');
  assert.equal(restored.person, state.person);
  assert.equal(restored.place, state.place);
  assert.equal(restored.embed, false);
  assert.ok(restored.viewport);
  assert.ok(Math.abs(restored.viewport.lng - state.viewport!.lng) <= 0.000005);
  assert.ok(Math.abs(restored.viewport.lat - state.viewport!.lat) <= 0.000005);
  assert.ok(Math.abs(restored.viewport.zoom - state.viewport!.zoom) <= 0.005);
  assert.equal(
    serializeExploreState(restored),
    href,
    'refreshing a shared URL must not change its state',
  );
});

test('query punctuation cannot inject another filter, embed flag, or URL fragment', () => {
  const text = 'John&scope=atlanta&embed=1#<script>alert("test")</script>';
  const state = { ...initialExploreState, q: text, theme: 'A+B & C' };
  const href = serializeExploreState(state);
  const url = new URL(href, origin);

  assert.equal(url.origin, origin);
  assert.equal(url.pathname, '/explore');
  assert.equal(url.hash, '');
  assert.equal(url.searchParams.getAll('scope').length, 1);
  assert.equal(url.searchParams.get('scope'), 'cemetery');
  assert.equal(url.searchParams.has('embed'), false);
  assert.equal(readState(href).q, text);
  assert.equal(readState(href).theme, state.theme);
});

test('standalone sharing removes embedding while retaining the actual exploration state', () => {
  const state: ExploreState = {
    ...initialExploreState,
    scope: 'atlanta',
    q: 'Lewis',
    theme: 'Civil Rights',
    person: 'john-lewis',
    place: 'atlanta-city-hall',
    viewport: { lng: -84.39059, lat: 33.74862, zoom: 15 },
    embed: true,
  };
  const embedded = serializeExploreState(state);
  const standalone = serializeExploreState(state, true);

  assert.equal(new URL(embedded, origin).searchParams.get('embed'), '1');
  assert.equal(new URL(standalone, origin).searchParams.has('embed'), false);
  assert.deepEqual(readState(standalone), { ...readState(embedded), embed: false });
  assert.equal(state.embed, true, 'sharing must not change the active embedded view');
});

test('a person link can carry the complete exploration URL through its from parameter', () => {
  const expected = {
    ...initialExploreState,
    scope: 'atlanta' as const,
    q: 'Herndon & family',
    person: 'alonzo-herndon',
    place: 'herndon-home',
    viewport: { lng: -84.40678, lat: 33.75581, zoom: 14.25 },
  };
  const returnPath = serializeExploreState(expected);
  const recordUrl = new URL(
    `/people/alonzo-herndon?from=${encodeURIComponent(returnPath)}`,
    origin,
  );
  const decodedReturnPath = recordUrl.searchParams.get('from');

  assert.equal(decodedReturnPath, returnPath);
  assert.deepEqual(readState(decodedReturnPath!), expected);
  assert.equal(recordUrl.pathname, '/people/alonzo-herndon');
});

test('unknown settings have conservative defaults and search input is bounded', () => {
  assert.deepEqual(parseExploreState(''), initialExploreState);
  const query = new URLSearchParams({
    scope: 'https://unrelated.example/',
    embed: 'true',
    q: 'x'.repeat(500),
    theme: 'y'.repeat(150),
    arbitrary: 'ignored',
  });
  const state = parseExploreState(query.toString());

  assert.equal(state.scope, 'cemetery');
  assert.equal(state.embed, false);
  assert.equal(state.q.length, 200);
  assert.equal(state.theme.length, 80);
  assert.equal(state.viewport, null);
  assert.equal(new URL(serializeExploreState(state), origin).searchParams.has('arbitrary'), false);
});

test('incomplete, nonnumeric, and out-of-range viewport parameters cannot move the map', () => {
  const badQueries = [
    'lng=-84.3&lat=33.7',
    'lng=-84.3&z=15',
    'lat=33.7&z=15',
    'lng=NaN&lat=33.7&z=15',
    'lng=-84.3&lat=Infinity&z=15',
    'lng=-84.3&lat=33.7&z=Infinity',
    'lng=181&lat=33.7&z=15',
    'lng=-181&lat=33.7&z=15',
    'lng=-84.3&lat=85&z=15',
    'lng=-84.3&lat=-85&z=15',
    'lng=-84.3&lat=33.7&z=0',
    'lng=-84.3&lat=33.7&z=21',
  ];
  for (const query of badQueries) assert.equal(parseExploreState(query).viewport, null, query);
});

test('blank coordinate fields are absent values rather than a location at zero longitude or latitude', () => {
  for (const query of [
    'lng=&lat=33.7&z=15',
    'lng=-84.3&lat=&z=15',
    'lng=&lat=&z=15',
    'lng=%20%20&lat=33.7&z=15',
    'lng=-84.3&lat=%09&z=15',
    'lng=-84.3&lat=33.7&z=',
  ])
    assert.equal(parseExploreState(query).viewport, null, query);

  assert.deepEqual(
    parseExploreState('lng=0&lat=0&z=5').viewport,
    { lng: 0, lat: 0, zoom: 5 },
    'explicit numeric zero remains valid',
  );
});
