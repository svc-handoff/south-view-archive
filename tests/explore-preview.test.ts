import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureArchive } from '../packages/db/src/fixtures';
import {
  createPreviewController,
  createMarkerHoverController,
  previewPosition,
  previewSelection,
} from '../apps/nextjs/src/lib/explore-preview';
import {
  initialExploreState,
  parseExploreState,
  serializeExploreState,
} from '../apps/nextjs/src/lib/explore-state';

test('an open record can switch person and waypoint without losing camera, filters, or its return URL', () => {
  const state = {
    ...initialExploreState,
    scope: 'atlanta' as const,
    q: 'Atlanta',
    theme: 'Civil Rights',
    person: 'martin-luther-king-sr',
    place: 'ebenezer-heritage',
    embed: true,
    viewport: { lng: -84.3942, lat: 33.7535, zoom: 13 },
  };
  const change = previewSelection(fixtureArchive, state.scope, {
    personId: 'john-lewis',
    placeId: 'atlanta-city-hall',
  });
  assert.deepEqual(change, { person: 'john-lewis', place: 'atlanta-city-hall' });
  const next = { ...state, ...change };
  assert.equal(next.viewport, state.viewport, 'hover must leave the camera object untouched');
  assert.equal(next.q, state.q);
  assert.equal(next.theme, state.theme);
  assert.equal(next.embed, true);
  assert.deepEqual(
    parseExploreState(new URL(serializeExploreState(next), 'https://example.org').search),
    next,
  );
});

test('different waypoints for the same person keep their exact place, including cemetery places in Atlanta view', () => {
  assert.deepEqual(
    previewSelection(fixtureArchive, 'atlanta', {
      personId: 'john-lewis',
      placeId: 'lewis-south-view',
    }),
    { person: 'john-lewis', place: 'lewis-south-view' },
  );
  assert.deepEqual(
    previewSelection(fixtureArchive, 'atlanta', {
      personId: 'john-lewis',
      placeId: 'atlanta-city-hall',
    }),
    { person: 'john-lewis', place: 'atlanta-city-hall' },
  );
});

test('a stale or mismatched waypoint cannot replace the open record', () => {
  for (const target of [
    { personId: 'john-lewis', placeId: 'king-sr-south-view' },
    { personId: 'unknown', placeId: 'lewis-south-view' },
    { personId: 'john-lewis', placeId: 'unknown' },
    { personId: 'john-lewis', placeId: 'atlanta-city-hall' },
  ])
    assert.equal(previewSelection(fixtureArchive, 'cemetery', target), null);
});

test('list previews choose a relevant place, and an unmapped person remains readable', () => {
  assert.deepEqual(previewSelection(fixtureArchive, 'cemetery', { personId: 'john-lewis' }), {
    person: 'john-lewis',
    place: 'lewis-south-view',
  });
  assert.deepEqual(previewSelection(fixtureArchive, 'atlanta', { personId: 'john-lewis' }), {
    person: 'john-lewis',
    place: 'atlanta-city-hall',
  });
  assert.deepEqual(
    previewSelection({ ...fixtureArchive, relations: [] }, 'cemetery', { personId: 'john-lewis' }),
    {
      person: 'john-lewis',
      place: null,
    },
  );
});

test('passing over a marker briefly does not replace the detail; settling on the next marker does', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const seen: Array<string | null> = [];
  const controller = createPreviewController<string>((value) => seen.push(value));
  controller.show('King');
  context.mock.timers.tick(20);
  controller.show('Lewis');
  context.mock.timers.tick(40);
  assert.deepEqual(seen, []);
  context.mock.timers.tick(20);
  assert.deepEqual(seen, ['Lewis']);
});

test('open drawer and keyboard previews can update immediately, cancelling any pending preview', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const seen: Array<string | null> = [];
  const controller = createPreviewController<string>((value) => seen.push(value));
  controller.show('King');
  controller.show('Lewis', true);
  assert.deepEqual(seen, ['Lewis']);
  context.mock.timers.tick(1000);
  assert.deepEqual(seen, ['Lewis']);
});

test('hover entered during camera motion is shown as soon as motion ends without re-entering', () => {
  const seen: Array<{ anchor: string } | null> = [];
  const hover = createMarkerHoverController<{ anchor: string }>((target) => seen.push(target));
  const lewis = { anchor: 'Lewis marker' };
  hover.startMove();
  hover.enter(lewis);
  assert.deepEqual(seen, [null]);
  hover.endMove(() => true);
  assert.deepEqual(seen, [null, lewis]);
});

test('camera settlement restores a stationary pointer only if the marker is still under it', () => {
  const seen: Array<{ anchor: string } | null> = [];
  const hover = createMarkerHoverController<{ anchor: string }>((target) => seen.push(target));
  const lewis = { anchor: 'Lewis marker' };
  hover.enter(lewis);
  hover.startMove();
  hover.endMove(() => true);
  assert.deepEqual(seen, [lewis, null, lewis]);
  hover.startMove();
  hover.endMove(() => false);
  assert.equal(seen.at(-1), null, 'a moved-away, removed or covered marker must not reopen');
});

test('leaving another marker cannot cancel the current hover, and dismissal cancels deferred settlement', () => {
  const seen: Array<{ anchor: string } | null> = [];
  const hover = createMarkerHoverController<{ anchor: string }>((target) => seen.push(target));
  const king = { anchor: 'King marker' };
  const lewis = { anchor: 'Lewis marker' };
  hover.enter(king);
  hover.enter(lewis);
  hover.leave(king.anchor);
  assert.equal(seen.at(-1), lewis);
  hover.startMove();
  hover.clear();
  const count = seen.length;
  hover.endMove(() => true);
  assert.equal(seen.length, count, 'Escape or window blur must not reopen a deferred hover');
});

test('leaving, dragging, Escape, and unmount can cancel pending hover without a delayed reopen', (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const seen: Array<string | null> = [];
  const controller = createPreviewController<string>((value) => seen.push(value));
  controller.show('King');
  controller.clear();
  context.mock.timers.tick(1000);
  assert.deepEqual(seen, [null]);
  controller.show('Lewis');
  controller.cancel();
  context.mock.timers.tick(1000);
  assert.deepEqual(seen, [null], 'unmount must not commit another state update');
});

test('wide-screen preview stays beside its marker instead of the viewport centre', () => {
  const position = previewPosition(
    { left: 900, right: 944, top: 450, bottom: 498 },
    { width: 280, height: 180 },
    { width: 2560, height: 1440 },
  );
  assert.equal(position.left, 956);
  assert.equal(position.top, 384);
  assert.equal(position.overlap, 0);
});

test('preview flips at the right edge and stays below the header and above attribution', () => {
  for (const top of [70, 440, 980]) {
    const anchor = { left: 1860, right: 1904, top, bottom: top + 48 };
    const position = previewPosition(
      anchor,
      { width: 280, height: 180 },
      { width: 1920, height: 1080 },
    );
    assert.ok(position.left + 280 < anchor.left);
    assert.ok(position.top >= 76);
    assert.ok(position.top + 180 <= 1044);
    assert.equal(position.overlap, 0);
  }
});

test('preview avoids the expanded results panel and remains beside a focused list row', () => {
  const sidebar = { left: 16, right: 376, top: 80, bottom: 750 };
  for (const anchor of [
    { left: 382, right: 426, top: 430, bottom: 478 },
    { left: 17, right: 375, top: 300, bottom: 450 },
  ]) {
    const position = previewPosition(
      anchor,
      { width: 280, height: 180 },
      { width: 1440, height: 900 },
      [sidebar],
    );
    assert.ok(position.left > sidebar.right);
    assert.equal(position.overlap, 0);
  }
});
