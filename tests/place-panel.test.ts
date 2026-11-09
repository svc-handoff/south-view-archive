import assert from 'node:assert/strict';
import test from 'node:test';
import { placeConnections, precisionLabels } from '../apps/nextjs/src/lib/place-mode';
import {
  initialExploreState,
  parseExploreState,
  serializeExploreState,
} from '../apps/nextjs/src/lib/explore-state';

const archive = {
  people: [
    { id: 'king', name: 'Martin Luther King Sr.' },
    { id: 'lewis', name: 'John Lewis' },
  ],
  relations: [
    { id: 'r1', personId: 'king', placeId: 'ebenezer' },
    { id: 'r2', personId: 'lewis', placeId: 'ebenezer' },
    { id: 'r3', personId: 'ghost', placeId: 'ebenezer' },
    { id: 'r4', personId: 'lewis', placeId: 'city-hall' },
  ],
};

test('a place lists everyone connected to it, the person it was reached from first', () => {
  const plain = placeConnections(archive, 'ebenezer');
  assert.deepEqual(
    plain.map((c) => c.person.id),
    ['king', 'lewis'],
    'relations to unknown people are left out, collection order otherwise',
  );
  const fromLewis = placeConnections(archive, 'ebenezer', 'lewis');
  assert.deepEqual(
    fromLewis.map((c) => c.relation.id),
    ['r2', 'r1'],
  );
  assert.deepEqual(placeConnections(archive, 'nowhere', 'lewis'), []);
  assert.equal(precisionLabels.reference, 'Reference position · unverified');
});

test('a place opened from a person round-trips through the URL, and only then', () => {
  const state = {
    ...initialExploreState,
    scope: 'atlanta' as const,
    person: 'lewis',
    place: 'city-hall',
    panel: 'place' as const,
  };
  const href = serializeExploreState(state);
  const url = new URL(href, 'https://archive.example.org');
  assert.equal(url.searchParams.get('panel'), 'place');
  assert.deepEqual(parseExploreState(url.search), state);

  // Without a person there is nothing to go back to: the flag is dropped and parsed away.
  const placeOnly = { ...state, person: null };
  const placeHref = new URL(serializeExploreState(placeOnly), 'https://archive.example.org');
  assert.equal(placeHref.searchParams.has('panel'), false);
  assert.equal(parseExploreState('?place=city-hall&panel=place').panel, 'person');
  assert.equal(parseExploreState('?person=lewis&panel=place').panel, 'person');
  assert.equal(parseExploreState('?person=lewis&place=city-hall&panel=nonsense').panel, 'person');

  // The person panel's URL is unchanged by the new flag.
  const personHref = serializeExploreState({ ...state, panel: 'person' });
  assert.equal(personHref, '/explore?scope=atlanta&person=lewis&place=city-hall');
});
