import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { archiveMapFeatures, archiveSearch, createCaller } from '../packages/api/src/index';
import {
  createArchiveLoader,
  ArchiveConfigurationError,
  ArchiveDatabaseError,
} from '../packages/db/src/index';
import { fixtureArchive } from '../packages/db/src/fixtures';
import { assertSeedAllowed, seedArchive } from '../packages/db/src/seed';
import {
  searchSchema,
  validateArchive,
  type ArchiveData,
  type Person,
} from '../packages/validators/src/index';

const source = {
  id: 'test-source',
  title: 'Test source',
  creator: 'Test',
  publisher: 'Test',
  url: 'https://example.org/source',
  accessedAt: '2026-10-03',
  kind: 'document' as const,
};
const citation = { sourceId: source.id };
function person(id: string, name: string, themes = ['Community']): Person {
  return {
    id,
    name,
    themes,
    aliases: [],
    summary: 'A test record.',
    summaryCitations: [citation],
    biography: [{ text: 'A cited paragraph.', citations: [citation] }],
  };
}
function sampleArchive(): ArchiveData {
  return {
    people: [
      person('alpha', 'Alice Sample'),
      person('beta', 'Bessie Sample'),
      person('gamma', 'Clara Sample', ['Arts']),
    ],
    places: [
      {
        id: 'burial',
        name: 'Shared cemetery reference',
        scope: 'cemetery',
        coordinates: [-84.379, 33.691],
        precision: 'reference',
        locationNote: 'Reference, not exact burial.',
        coordinateCitations: [citation],
      },
      {
        id: 'church',
        name: 'City church',
        scope: 'atlanta',
        coordinates: [-84.374, 33.755],
        precision: 'address',
        locationNote: 'Address level.',
        coordinateCitations: [citation],
      },
      {
        id: 'unlocated',
        name: 'Unmapped location',
        scope: 'cemetery',
        coordinates: null,
        precision: 'unmapped',
        locationNote: 'No position supplied.',
        coordinateCitations: [],
      },
    ],
    relations: [
      {
        id: 'r-a',
        personId: 'alpha',
        placeId: 'burial',
        label: 'Buried',
        description: 'Test relation',
        citations: [citation],
      },
      {
        id: 'r-b',
        personId: 'beta',
        placeId: 'burial',
        label: 'Buried',
        description: 'Test relation',
        citations: [citation],
      },
      {
        id: 'r-c',
        personId: 'alpha',
        placeId: 'church',
        label: 'Served',
        description: 'Test relation',
        citations: [citation],
      },
      {
        id: 'r-d',
        personId: 'gamma',
        placeId: 'unlocated',
        label: 'Buried',
        description: 'Test relation',
        citations: [citation],
      },
    ],
    materials: [
      {
        id: 'm-a',
        personId: 'alpha',
        title: 'Test document',
        kind: 'document',
        description: 'Test',
        sourceId: source.id,
      },
    ],
    sources: [source],
    issues: [
      {
        personId: 'alpha',
        field: 'coordinates',
        note: 'Reference point only.',
        sourceIds: [source.id],
      },
    ],
    crosswalk: [
      {
        project: 'legacy',
        externalId: 'family-group',
        personId: null,
        note: 'A group is not a person; unresolved.',
      },
      {
        project: 'legacy',
        externalId: 'alice',
        personId: 'alpha',
        note: 'Individually identified.',
      },
    ],
  };
}

test('curated fixtures satisfy references and mapped places remain in metropolitan Atlanta', () => {
  const data = validateArchive(fixtureArchive);
  assert.ok(data.people.length > 0);
  for (const place of data.places) {
    if (!place.coordinates) continue;
    const [longitude, latitude] = place.coordinates;
    assert.ok(
      longitude > -84.65 && longitude < -84.1,
      `${place.id}: longitude outside local bounds`,
    );
    assert.ok(latitude > 33.5 && latitude < 33.95, `${place.id}: latitude outside local bounds`);
  }
});

test('validation rejects dangling references, duplicate identities and uncited coordinates', () => {
  const missingSource = sampleArchive();
  missingSource.sources = [];
  assert.throws(() => validateArchive(missingSource), /Missing source/);
  const brokenRelation = sampleArchive();
  brokenRelation.relations[0]!.personId = 'not-present';
  assert.throws(() => validateArchive(brokenRelation), /Broken relation/);
  const duplicatePerson = sampleArchive();
  duplicatePerson.people.push(duplicatePerson.people[0]!);
  assert.throws(() => validateArchive(duplicatePerson), /Duplicate people/);
  const uncitedPoint = sampleArchive();
  uncitedPoint.places[0]!.coordinateCitations = [];
  assert.throws(() => validateArchive(uncitedPoint), /Uncited location/);
  const unmappedPrecision = sampleArchive();
  unmappedPrecision.places[2]!.precision = 'verified';
  assert.throws(() => validateArchive(unmappedPrecision), /Missing coordinates/);
});

test('GeoJSON uses longitude then latitude and groups people sharing a place', () => {
  const features = archiveMapFeatures(sampleArchive(), searchSchema.parse({}));
  assert.equal(features.type, 'FeatureCollection');
  assert.equal(features.features.length, 1);
  assert.deepEqual(features.features[0]!.geometry.coordinates, [-84.379, 33.691]);
  assert.deepEqual(features.features[0]!.properties.personIds, ['alpha', 'beta']);
});

test('search/filter counts match map features without hiding records that lack coordinates', () => {
  const data = sampleArchive();
  for (const input of [
    {},
    { q: 'Alice' },
    { q: 'no match' },
    { theme: 'Community' },
    { theme: 'Arts' },
    { scope: 'atlanta' },
    { q: 'City church', scope: 'atlanta' },
  ]) {
    const filters = searchSchema.parse(input);
    const result = archiveSearch(data, filters);
    const geojson = archiveMapFeatures(data, filters);
    const mappedIds = new Set(geojson.features.flatMap((feature) => feature.properties.personIds));
    assert.equal(result.total, result.people.length);
    assert.equal(result.mappedPlaceCount, geojson.features.length);
    assert.equal(result.mappedPeopleCount, mappedIds.size);
    assert.ok([...mappedIds].every((id) => result.people.some((person) => person.id === id)));
    assert.ok(
      geojson.features.every(
        (feature) => filters.scope === 'atlanta' || feature.properties.scope === 'cemetery',
      ),
    );
  }
  const unmapped = archiveSearch(data, searchSchema.parse({ theme: 'Arts' }));
  assert.equal(unmapped.total, 1);
  assert.equal(unmapped.mappedPeopleCount, 0);
  assert.equal(unmapped.mappedPlaceCount, 0);
});

test('the Atlanta overview includes every cemetery place, shared relationship and unmapped record', () => {
  const data = sampleArchive();
  const city = archiveSearch(data, searchSchema.parse({ scope: 'atlanta' }));
  assert.deepEqual(
    new Set(city.places.map((p) => p.id)),
    new Set(['burial', 'church', 'unlocated']),
  );
  assert.equal(city.people.length, 3);
  assert.equal(city.relations.length, data.relations.length);
  const features = archiveMapFeatures(data, searchSchema.parse({ scope: 'atlanta' }));
  assert.equal(features.features.length, 2);
  assert.deepEqual(features.features.find((f) => f.id === 'burial')!.properties.personIds, [
    'alpha',
    'beta',
  ]);
  const filtered = archiveSearch(data, searchSchema.parse({ scope: 'atlanta', q: 'Alice' }));
  assert.deepEqual(
    filtered.people.map((p) => p.id),
    ['alpha'],
  );
  assert.ok(filtered.relations.every((r) => r.personId === 'alpha'));
  assert.deepEqual(new Set(filtered.places.map((p) => p.id)), new Set(['burial', 'church']));
});

test('legacy groups remain unresolved and are never auto-merged into a person', () => {
  const data = validateArchive(sampleArchive());
  assert.equal(data.crosswalk.find((item) => item.externalId === 'family-group')!.personId, null);
  assert.equal(data.people.length, 3);
  assert.equal(new Set(data.people.map((person) => person.id)).size, 3);
});

test('fixture mode does not connect; database misconfiguration, failure and invalid data never fall back', async () => {
  let calls = 0;
  const reader = async () => {
    calls++;
    return sampleArchive();
  };
  assert.equal(
    (await createArchiveLoader({ ARCHIVE_DATA_MODE: 'fixture' }, reader)()).people.length,
    fixtureArchive.people.length,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    createArchiveLoader({ ARCHIVE_DATA_MODE: 'typo' }, reader),
    ArchiveConfigurationError,
  );
  await assert.rejects(
    createArchiveLoader({ ARCHIVE_DATA_MODE: 'database' }, reader),
    /DATABASE_URL is required/,
  );
  assert.equal(calls, 0);
  const environment = {
    ARCHIVE_DATA_MODE: 'database',
    DATABASE_URL: 'postgres://private:secret@unavailable/archive',
  };
  await assert.rejects(
    createArchiveLoader(environment, async () => {
      throw new Error(environment.DATABASE_URL);
    }),
    (error) => {
      assert.ok(error instanceof ArchiveDatabaseError);
      assert.ok(!error.message.includes('secret'));
      return true;
    },
  );
  await assert.rejects(
    createArchiveLoader(environment, async () => ({ ...sampleArchive(), sources: [] })),
    ArchiveDatabaseError,
  );
  assert.equal((await createArchiveLoader(environment, reader)()).people.length, 3);
  assert.equal(calls, 1);
});

test('public tRPC archive interface returns cited records and rejects unknown identities', async () => {
  const previousMode = process.env.ARCHIVE_DATA_MODE;
  process.env.ARCHIVE_DATA_MODE = 'fixture';
  try {
    const caller = createCaller({});
    const snapshot = await caller.archive.snapshot();
    const id = snapshot.people[0]!.id;
    const detail = await caller.archive.person({ id });
    assert.equal(detail.person.id, id);
    assert.ok(detail.sources.length > 0);
    const query = { q: '', theme: 'all', scope: 'cemetery' as const };
    const [search, features] = await Promise.all([
      caller.archive.search(query),
      caller.archive.mapFeatures(query),
    ]);
    assert.equal(search.mappedPlaceCount, features.features.length);
    await assert.rejects(caller.archive.person({ id: 'not-an-archive-id' }), { code: 'NOT_FOUND' });
  } finally {
    if (previousMode === undefined) delete process.env.ARCHIVE_DATA_MODE;
    else process.env.ARCHIVE_DATA_MODE = previousMode;
  }
});

test('seeding requires an explicit confirmation and a separate production opt-in', () => {
  assert.throws(() => assertSeedAllowed({}, []), /--confirm/);
  assert.throws(
    () => assertSeedAllowed({ NODE_ENV: 'production' }, ['--confirm']),
    /Production seeding is disabled/,
  );
  assert.doesNotThrow(() => assertSeedAllowed({}, ['--confirm']));
  assert.doesNotThrow(() =>
    assertSeedAllowed({ NODE_ENV: 'production' }, ['--confirm', '--allow-production']),
  );
});

test('versioned SQL and seed run transactionally in PostgreSQL, preserve edits and reject broken relations', async () => {
  const database = new PGlite();
  try {
    const migration = await readFile(
      new URL('../packages/db/migrations/0001_archive.sql', import.meta.url),
      'utf8',
    );
    await database.exec(migration);
    const seed = () =>
      database.transaction(async (transaction) => seedArchive(transaction, sampleArchive()));
    await seed();
    await database.query(
      "UPDATE archive.persons SET data = jsonb_set(data, '{summary}', '\"Curator update\"'::jsonb) WHERE id = 'alpha'",
    );
    await seed();
    const people = await database.query<{ data: Person }>(
      'SELECT data FROM archive.persons ORDER BY id',
    );
    assert.equal(people.rows.length, 3);
    assert.equal(people.rows[0]!.data.summary, 'Curator update');
    const crosswalk = await database.query<{ person_id: string | null }>(
      "SELECT person_id FROM archive.crosswalk WHERE external_id = 'family-group'",
    );
    assert.equal(crosswalk.rows[0]!.person_id, null);
    await assert.rejects(
      database.transaction(async (transaction) => {
        await transaction.query('INSERT INTO archive.persons (id, data) VALUES ($1, $2::jsonb)', [
          'rolled-back',
          JSON.stringify(person('rolled-back', 'Transient')),
        ]);
        await transaction.query(
          'INSERT INTO archive.person_places (id, person_id, place_id, data) VALUES ($1, $2, $3, $4::jsonb)',
          [
            'invalid',
            'rolled-back',
            'missing',
            JSON.stringify({
              ...sampleArchive().relations[0],
              id: 'invalid',
              personId: 'rolled-back',
              placeId: 'missing',
            }),
          ],
        );
      }),
    );
    const rolledBack = await database.query(
      "SELECT id FROM archive.persons WHERE id = 'rolled-back'",
    );
    assert.equal(rolledBack.rows.length, 0);
  } finally {
    await database.close();
  }
});
