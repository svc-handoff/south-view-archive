import assert from 'node:assert/strict';
import test from 'node:test';
import { directionsUrl, soleOccupant } from '../apps/nextjs/src/lib/place-mode';

const archive = {
  places: [
    { id: 'grave', scope: 'cemetery' as const },
    { id: 'crypt', scope: 'cemetery' as const },
    { id: 'hall', scope: 'atlanta' as const },
    { id: 'lonely-church', scope: 'atlanta' as const },
  ],
  relations: [
    { personId: 'a', placeId: 'grave' },
    { personId: 'a', placeId: 'grave' },
    { personId: 'b', placeId: 'crypt' },
    { personId: 'c', placeId: 'crypt' },
    { personId: 'a', placeId: 'hall' },
    { personId: 'd', placeId: 'lonely-church' },
  ],
};

test('a grave with one person opens as that person', () => {
  assert.equal(soleOccupant(archive, 'grave'), 'a');
});

test('a shared crypt and every city place open as places', () => {
  assert.equal(soleOccupant(archive, 'crypt'), null);
  assert.equal(soleOccupant(archive, 'hall'), null);
  assert.equal(soleOccupant(archive, 'lonely-church'), null);
  assert.equal(soleOccupant(archive, 'missing'), null);
  assert.equal(soleOccupant(archive, null), null);
});

test('directions go to Google Maps with latitude first', () => {
  // Places store longitude first, as the map does.
  assert.equal(
    directionsUrl([-84.3751025, 33.7027115]),
    'https://www.google.com/maps/dir/?api=1&destination=33.7027115,-84.3751025',
  );
});
