import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterRecordOptions,
  recordDescription,
  type RecordOption,
} from '../apps/nextjs/src/lib/record-options';

test('record search supports aliases, punctuation, accents and year disambiguation without merging names', () => {
  const people: RecordOption[] = [
    {
      id: 'king-sr',
      name: 'Martin Luther King Sr.',
      aliases: ['Michael King', 'Daddy King'],
      birthYear: 1899,
      deathYear: 1984,
    },
    { id: 'king-jr', name: 'Martin Luther King Jr.', birthYear: 1929, deathYear: 1968 },
    { id: 'jose-a', name: 'José Martinez', birthYear: 1935 },
    { id: 'jose-b', name: 'José Martinez', birthYear: 1975 },
  ];
  for (const query of ['DADDY king', 'King, Sr.', 'Michael King', '1984'])
    assert.deepEqual(
      filterRecordOptions(people, query).map(({ id }) => id),
      ['king-sr'],
    );
  assert.deepEqual(
    filterRecordOptions(people, 'martin king').map(({ id }) => id),
    ['king-sr', 'king-jr'],
  );
  assert.deepEqual(
    filterRecordOptions(people, 'jose').map(({ id }) => id),
    ['jose-a', 'jose-b'],
  );
  assert.deepEqual(
    filterRecordOptions(people, 'Jose 1975').map(({ id }) => id),
    ['jose-b'],
  );
  assert.equal(filterRecordOptions(people, 'unknown name').length, 0);
});

test('large catalogs search by meaningful context and retain stable independent record IDs', () => {
  const catalog: RecordOption[] = Array.from({ length: 2500 }, (_, index) => ({
    id: `record-${index}`,
    name: `Community person ${index}`,
    aliases: index === 2345 ? ['A remembered alternate name'] : [],
  }));
  assert.deepEqual(
    filterRecordOptions(catalog, 'remembered alternate').map(({ id }) => id),
    ['record-2345'],
  );
  assert.equal(filterRecordOptions(catalog, '').length, catalog.length);
  assert.deepEqual(catalog[2345]?.aliases, ['A remembered alternate name']);
  const places: RecordOption[] = [
    { id: 'city', name: 'Memorial', scope: 'atlanta' },
    { id: 'cemetery', name: 'Memorial', scope: 'cemetery' },
  ];
  assert.deepEqual(
    filterRecordOptions(places, 'Memorial South View').map(({ id }) => id),
    ['cemetery'],
  );
  assert.equal(recordDescription(places[0]!), 'Atlanta');
});
