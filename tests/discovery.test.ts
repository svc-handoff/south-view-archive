import assert from 'node:assert/strict';
import test from 'node:test';
import { createCaller } from '@southview/api';
import { createStore, setStoreForTests } from '@southview/db/connection';
import { fixtureArchive } from '@southview/db/fixtures';
import { seedArchive } from '@southview/db/seed';
import {
  contributionEntrySchema,
  discoverArchive,
  discoveryInputSchema,
  discoveryPlainText,
  DISCOVERY_PAGE_SIZE,
  matchedPersonIds,
  publicRelatedPersonIds,
  searchArchive,
  searchSchema,
  validateArchive,
  type ArchiveData,
  type ContributionEntry,
} from '@southview/validators';

function story(overrides: Partial<ContributionEntry> = {}): ContributionEntry {
  return contributionEntrySchema.parse({
    id: 'lantern-evening',
    personId: 'john-lewis',
    relatedPersonIds: ['alonzo-herndon'],
    placeIds: ['herndon-home'],
    eventDate: { kind: 'approximate', year: 1965 },
    kind: 'memory',
    title: 'A lantern evening',
    body: 'The family remembers a lantern procession through the neighborhood.',
    context: 'An attributed recollection, kept separate from the curated biography.',
    sourceCreator: 'Miriam Test',
    narrator: 'Avery Narrator',
    holdingInstitution: 'Neighborhood Archive',
    creditId: 'community-credit',
    sourceIds: ['house-lewis-biography'],
    photos: [
      {
        id: 'public-photo',
        url: '/api/community/media/public-photo',
        caption: 'Reunion keepsake',
        creator: 'Avery Photographer',
        rights: 'Shared by the rights holder for this archive.',
        creditId: 'community-credit',
        width: 800,
        height: 600,
      },
    ],
    publishedAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  });
}
function archive(): ArchiveData {
  const copy = structuredClone(fixtureArchive);
  copy.credits.push({
    id: 'community-credit',
    displayName: 'Avery Contributor',
    kind: 'community',
  });
  copy.contributions = [story()];
  copy.materials[0] = {
    ...copy.materials[0]!,
    relatedPersonIds: ['alonzo-herndon'],
    placeIds: ['atlanta-city-hall'],
    eventDate: { kind: 'range', startYear: 1960, endYear: 1970 },
    description: 'An interview discussing lithography and community archives.',
    narrator: 'Quincy Oral Narrator',
    interviewer: 'Cassidy Interviewer',
  };
  return validateArchive(copy);
}

test('discovery searches aliases and full biography and retains permanent typed identities', () => {
  const data = archive();
  assert.equal(
    discoverArchive(data, { q: 'Congressman John Lewis', type: 'person' }).items[0]?.entityId,
    'john-lewis',
  );
  const result = discoverArchive(data, { q: 'Student Nonviolent Coordinating', type: 'person' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.id, 'person:john-lewis');
  assert.equal(result.items[0]?.url, '/people/john-lewis');
  assert.match(result.items[0]!.excerpt, /Student Nonviolent Coordinating/);
  assert.ok(result.items[0]!.sourceIds.includes('house-lewis-biography'));
  assert.deepEqual(
    publicRelatedPersonIds({
      personId: 'john-lewis',
      relatedPersonIds: ['john-lewis', 'alonzo-herndon', 'alonzo-herndon'],
    }),
    ['john-lewis', 'alonzo-herndon'],
  );
});

test('published stories, roles, public captions and source metadata make related map people searchable', () => {
  const data = archive();
  const result = discoverArchive(data, { q: 'lantern procession', type: 'story' });
  assert.equal(result.total, 1);
  assert.deepEqual(result.items[0]!.personIds, ['john-lewis', 'alonzo-herndon']);
  assert.equal(result.items[0]!.url, '/contributions/lantern-evening');
  assert.deepEqual(result.items[0]!.eventDate, { kind: 'approximate', year: 1965 });
  assert.deepEqual([...matchedPersonIds(data, 'lantern procession')].sort(), [
    'alonzo-herndon',
    'john-lewis',
  ]);
  const mapped = searchArchive(
    data,
    searchSchema.parse({ q: 'lantern procession', scope: 'atlanta' }),
  );
  assert.deepEqual(mapped.people.map((person) => person.id).sort(), [
    'alonzo-herndon',
    'john-lewis',
  ]);
  assert.ok(mapped.places.some((place) => place.id === 'herndon-home'));
  for (const term of [
    'Miriam Test',
    'Avery Narrator',
    'Neighborhood Archive',
    'Reunion keepsake',
    'Avery Photographer',
    'Avery Contributor',
  ]) {
    assert.equal(discoverArchive(data, { q: term, type: 'story' }).total, 1, term);
  }
  for (const term of ['lithography', 'Quincy Oral Narrator', 'Cassidy Interviewer']) {
    assert.equal(discoverArchive(data, { q: term, type: 'material' }).total, 1, term);
    assert.ok(matchedPersonIds(data, term).has('alonzo-herndon'));
  }
  const source = data.sources.find((source) => source.id === data.materials[0]!.sourceId)!;
  source.catalogueId = 'CATALOGUE-ZEBRA-42';
  assert.equal(discoverArchive(data, { q: 'CATALOGUE-ZEBRA-42', type: 'material' }).total, 1);
});

test('type facets and person/place/theme filters compose without inventing story locations', () => {
  const data = archive();
  const result = discoverArchive(data, {
    q: 'lantern',
    type: 'story',
    personId: 'alonzo-herndon',
    placeId: 'herndon-home',
    theme: 'Enterprise',
  });
  assert.equal(result.total, 1);
  assert.equal(result.counts.story, 1);
  assert.equal(result.counts.photo, 1);
  assert.equal(result.counts.all, 2);
  assert.equal(
    discoverArchive(data, { type: 'story', personId: 'martin-luther-king-sr' }).total,
    0,
  );
  assert.equal(
    discoverArchive(data, { type: 'story', placeId: 'lewis-south-view' }).total,
    0,
    'a person’s grave is not automatically a story location',
  );
  assert.equal(discoverArchive(data, { type: 'material', placeId: 'atlanta-city-hall' }).total, 1);
  assert.equal(discoverArchive(data, { type: 'story', theme: 'Faith & Community' }).total, 0);
});

test('photo discovery uses only approved public copies and retains explicit copyright and stable anchors', () => {
  const data = archive();
  const result = discoverArchive(data, { type: 'photo' });
  assert.equal(result.total, 2);
  const portrait = result.items.find((item) => item.id === 'photo:portrait:john-lewis')!;
  assert.equal(portrait.type, 'photo');
  if (portrait.type !== 'photo') assert.fail('expected photo');
  assert.equal(portrait.url, '/people/john-lewis#photo-portrait');
  assert.equal(portrait.photo.url, '/images/john-lewis.jpg');
  assert.match(portrait.photo.rights, /Public domain/);
  assert.equal(portrait.photo.sourceId, 'commons-john-lewis-portrait');
  const submitted = result.items.find((item) => item.id === 'photo:public-photo')!;
  assert.equal(submitted.type, 'photo');
  if (submitted.type !== 'photo') assert.fail('expected photo');
  assert.equal(submitted.url, '/contributions/lantern-evening#photo-public-photo');
  assert.equal(submitted.photo.url, '/api/community/media/public-photo');
  assert.equal(submitted.photo.creator, 'Avery Photographer');
  assert.equal(submitted.photo.width, 800);
  delete data.sources.find((source) => source.id === 'commons-john-lewis-portrait')!.rights;
  assert.equal(
    discoverArchive(data, { type: 'photo' }).total,
    1,
    'an initial portrait without explicit rights is not indexed as a reusable photo',
  );
});

test('discovery excludes private objects and returns text-only excerpts without changing its input', () => {
  const data = archive();
  Object.assign(data, {
    submissions: [
      { title: 'private-sentinel', body: 'private-sentinel', privateName: 'private-sentinel' },
    ],
    contacts: [{ email: 'private-sentinel@example.org' }],
  });
  Object.assign(data.contributions[0]!, {
    internalNote: 'private-sentinel',
    originalKey: 'private-sentinel',
  });
  const before = structuredClone(data);
  assert.equal(discoverArchive(data, { q: 'private-sentinel' }).total, 0);
  assert.equal(matchedPersonIds(data, 'private-sentinel').size, 0);
  assert.deepEqual(data, before);
  data.contributions[0]!.body = `${'Earlier recollections. '.repeat(30)} <script>stealReceipt()</script><strong>Jubilant café gathering</strong> &amp; neighbors.`;
  const result = discoverArchive(data, { q: 'JUBILANT cafe', type: 'story' }).items[0]!;
  assert.match(result.excerpt, /Jubilant café gathering/);
  assert.ok(result.excerpt.length <= 222);
  assert.doesNotMatch(result.excerpt, /[<>]|stealReceipt/);
  assert.equal(
    discoveryPlainText('&lt;script&gt;secret()&lt;/script&gt;Good &amp; kind &#x1f33f;'),
    'Good & kind 🌿',
  );
});

test('pagination and relevance are deterministic, deduplicated, bounded and independent of input order', () => {
  const data = archive();
  data.contributions = Array.from({ length: 29 }, (_, index) =>
    story({
      id: `stable-${String(index).padStart(2, '0')}`,
      title: 'Same public title',
      photos: [],
    }),
  );
  const first = discoverArchive(data, { type: 'story', page: 1 });
  assert.equal(first.total, 29);
  assert.equal(first.pageSize, DISCOVERY_PAGE_SIZE);
  assert.equal(first.totalPages, 3);
  const all = [1, 2, 3].flatMap((page) =>
    discoverArchive(data, { type: 'story', page }).items.map((item) => item.id),
  );
  assert.equal(all.length, 29);
  assert.equal(new Set(all).size, 29);
  data.contributions.reverse();
  assert.deepEqual(
    discoverArchive(data, { type: 'story', page: 1 }).items.map((item) => item.id),
    first.items.map((item) => item.id),
  );
  assert.equal(discoverArchive(data, { type: 'story', page: 999 }).page, 3);
  data.contributions.push(data.contributions[0]!);
  assert.equal(discoverArchive(data, { type: 'story' }).total, 29);
  const empty = discoverArchive(data, { q: 'no-matching-archival-text', page: 999 });
  assert.equal(empty.page, 1);
  assert.equal(empty.total, 0);
  assert.equal(empty.items.length, 0);
  const person = discoverArchive(data, { q: 'John Lewis' }).items[0]!;
  assert.equal(person.type, 'person', 'an exact person title precedes associated documents');
});

test('recent sorting uses publication dates and places undated materials after pre-1970 dates', () => {
  const data = archive();
  data.contributions = [
    story({
      id: 'recent-publication',
      photos: [],
      publishedAt: '2026-10-01T00:00:00.000Z',
      eventDate: { kind: 'year', year: 1900 },
    }),
    story({
      id: 'earlier-publication',
      photos: [],
      publishedAt: '2025-10-01T00:00:00.000Z',
      eventDate: { kind: 'year', year: 2020 },
    }),
  ];
  assert.deepEqual(
    discoverArchive(data, { type: 'story', sort: 'recent' }).items.map((item) => item.entityId),
    ['recent-publication', 'earlier-publication'],
  );
  data.materials[0]!.date = '1940';
  for (const material of data.materials.slice(1)) {
    delete material.date;
    delete data.sources.find((source) => source.id === material.sourceId)!.date;
  }
  assert.equal(
    discoverArchive(data, { type: 'material', sort: 'recent' }).items[0]!.entityId,
    data.materials[0]!.id,
  );
});

test('discovery input validation rejects unbounded or malformed pagination and query values', () => {
  assert.equal(discoveryInputSchema.parse({}).featured, false);
  assert.equal(discoveryInputSchema.parse({ page: '2' }).page, 2);
  for (const input of [
    { page: 0 },
    { page: -1 },
    { page: 1.5 },
    { page: 100_001 },
    { q: 'x'.repeat(201) },
    { type: 'private' },
  ]) {
    assert.throws(() => discoveryInputSchema.parse(input));
  }
});

test('editor selections filter public stories and rank them first only in empty relevance browsing', () => {
  const data = archive();
  data.contributions = [
    story({
      id: 'selected',
      title: 'Zebra recollection',
      body: 'A family remembers the lantern procession together.',
      featured: true,
      photos: [],
      publishedAt: '2025-01-01T00:00:00.000Z',
    }),
    story({
      id: 'ordinary',
      title: 'Lantern procession',
      featured: false,
      photos: [],
      publishedAt: '2026-01-01T00:00:00.000Z',
    }),
  ];
  const browsed = discoverArchive(data, {});
  assert.equal(browsed.items[0]!.id, 'story:selected');
  const selected = discoverArchive(data, { featured: true });
  assert.deepEqual(
    selected.items.map((item) => item.id),
    ['story:selected'],
  );
  assert.equal(selected.counts.all, 1);
  assert.equal(selected.counts.story, 1);
  assert.equal(selected.counts.person, 0);
  assert.equal(selected.counts.photo, 0);
  assert.equal(discoverArchive(data, { type: 'photo', featured: true }).total, 0);
  assert.equal(discoverArchive(data, { featured: true, q: 'missing phrase' }).total, 0);
  assert.equal(
    discoverArchive(data, { featured: true, personId: 'martin-luther-king-sr' }).total,
    0,
  );
  assert.equal(
    discoverArchive(data, { q: 'lantern procession', type: 'story' }).items[0]!.id,
    'story:ordinary',
    'an exact text match outranks editorial selection',
  );
  assert.equal(
    discoverArchive(data, { type: 'story', sort: 'recent' }).items[0]!.id,
    'story:ordinary',
    'recent sorting remains chronological',
  );
  const legacy = story({ id: 'legacy', photos: [] });
  assert.equal(legacy.featured, false);
  data.contributions = [legacy];
  const legacyResult = discoverArchive(data, { type: 'story' }).items[0]!;
  assert.equal(legacyResult.type === 'story' && legacyResult.featured, false);
});

test('tRPC person API uses the public projection and includes secondary subjects', async (t) => {
  const data = archive();
  const store = await createStore({ mode: 'local', path: 'memory://', seed: false });
  const previousMode = process.env.ARCHIVE_DATA_MODE;
  process.env.ARCHIVE_DATA_MODE = 'local';
  setStoreForTests(store);
  t.after(async () => {
    setStoreForTests(undefined);
    if (previousMode === undefined) delete process.env.ARCHIVE_DATA_MODE;
    else process.env.ARCHIVE_DATA_MODE = previousMode;
    await store.close();
  });
  await store.transaction(async (tx) => {
    await seedArchive(tx, data);
    await tx.query('INSERT INTO archive.credits (id,data) VALUES ($1,$2::jsonb)', [
      'community-credit',
      JSON.stringify(data.credits.find((credit) => credit.id === 'community-credit')),
    ]);
    const entry = data.contributions[0]!;
    await tx.query(
      'INSERT INTO archive.contributions (id,person_id,credit_id,data) VALUES ($1,$2,$3,$4::jsonb)',
      [entry.id, entry.personId, entry.creditId, JSON.stringify(entry)],
    );
  });
  const caller = createCaller({});
  const secondary = await caller.archive.person({ id: 'alonzo-herndon' });
  assert.ok(secondary.contributions.some((entry) => entry.id === 'lantern-evening'));
  assert.ok(secondary.materials.some((material) => material.id === data.materials[0]!.id));
  assert.ok(secondary.sources.some((source) => source.id === data.materials[0]!.sourceId));
  assert.equal(JSON.stringify(await caller.archive.snapshot()).includes('private-sentinel'), false);
});
