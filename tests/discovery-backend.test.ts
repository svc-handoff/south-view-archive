import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  eventDateSchema,
  formatEventDate,
  submissionInputSchema,
  contributionEntrySchema,
  reviewInputSchema,
  type Actor,
} from '../packages/validators/src/community';
import { createStore, setStoreForTests } from '../packages/db/src/connection';
import { readStoreArchive } from '../packages/db/src/database';
import {
  createDraft,
  updateDraft,
  finalizeSubmission,
  getSubmission,
  reviewSubmission,
  getPublicContribution,
} from '../packages/db/src/community';

const guest: Actor = { userId: null, email: null, reviewer: false };
const reviewer: Actor = {
  userId: 'discovery-test-reviewer',
  email: 'reviewer@example.org',
  reviewer: true,
};
function input(overrides: Record<string, unknown> = {}) {
  return submissionInputSchema.parse({
    clientRequestId: randomUUID(),
    kind: 'addition',
    personId: 'john-lewis',
    title: 'A gathering remembered',
    body: 'A family document connects several Atlanta residents and places in one story.',
    privateName: 'Private Discovery Contact',
    email: 'private-discovery@example.org',
    anonymous: false,
    displayName: 'Family collection contributor',
    permission: true,
    ...overrides,
  });
}
const review = (overrides: Record<string, unknown> = {}) =>
  reviewInputSchema.parse({ action: 'publish', ...overrides });
async function submitted(overrides: Record<string, unknown> = {}) {
  const receipt = randomUUID() + randomUUID();
  const actor = { ...guest, receiptToken: receipt };
  const created = await createDraft(input(overrides), guest, receipt);
  await finalizeSubmission(created.submission.id, actor);
  return { id: created.submission.id, actor };
}

test('event dates preserve uncertainty, validate ranges and default legacy records without invented dates', () => {
  assert.deepEqual(input().eventDate, { kind: 'unknown' });
  assert.equal(formatEventDate({ kind: 'year', year: 1963 }), '1963');
  assert.equal(formatEventDate({ kind: 'approximate', year: 1960 }), 'c. 1960');
  assert.equal(formatEventDate({ kind: 'range', startYear: 1959, endYear: 1965 }), '1959–1965');
  assert.equal(formatEventDate({ kind: 'unknown' }), 'Date unknown');
  for (const date of [
    { kind: 'year', year: 0 },
    { kind: 'year', year: 10000 },
    { kind: 'year', year: 1963.5 },
    { kind: 'range', startYear: 1965, endYear: 1959 },
  ])
    assert.equal(eventDateSchema.safeParse(date).success, false);
  const parsed = input({
    relatedPersonIds: ['john-lewis', 'alonzo-herndon', 'alonzo-herndon'],
    placeIds: ['place-a', 'place-a'],
  });
  assert.deepEqual(parsed.relatedPersonIds, ['alonzo-herndon']);
  assert.deepEqual(parsed.placeIds, ['place-a']);
  assert.deepEqual(
    review({ relatedPersonIds: [], placeIds: [], eventDate: { kind: 'unknown' } }).relatedPersonIds,
    [],
  );
  assert.equal(review().relatedPersonIds, undefined);
  const legacy = contributionEntrySchema.parse({
    id: 'legacy',
    personId: 'john-lewis',
    kind: 'memory',
    title: 'Older published memory',
    body: 'An older published record with no structured event date.',
    context: '',
    creditId: 'initial-compilation',
    sourceIds: [],
    photos: [],
    publishedAt: '2026-10-03T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
  });
  assert.deepEqual(legacy.relatedPersonIds, []);
  assert.deepEqual(legacy.placeIds, []);
  assert.deepEqual(legacy.eventDate, { kind: 'unknown' });
  assert.equal(legacy.featured, false);
});

test('only reviewer publication can select a featured story and the guest original remains unchanged', async () => {
  const previousMode = process.env.ARCHIVE_DATA_MODE;
  process.env.ARCHIVE_DATA_MODE = 'local';
  const store = await createStore({ mode: 'local', path: 'memory://' });
  setStoreForTests(store);
  try {
    const token = randomUUID() + randomUUID();
    const maliciousInput = Object.assign(input({ anonymous: true, displayName: '' }), {
      featured: true,
    });
    const created = await createDraft(maliciousInput, guest, token);
    const actor = { ...guest, receiptToken: token };
    const original = structuredClone(created.submission.input);
    assert.equal('featured' in original, false);
    await finalizeSubmission(created.submission.id, actor);
    await assert.rejects(
      reviewSubmission(created.submission.id, review({ featured: true }), actor),
      { code: 'FORBIDDEN' },
    );
    await reviewSubmission(created.submission.id, review(), reviewer);
    assert.equal(
      (await getPublicContribution(created.submission.id))!.featured,
      false,
      'the guest field cannot select a story when the reviewer leaves selection off',
    );
    assert.deepEqual((await getSubmission(created.submission.id, actor)).input, original);

    const selected = await submitted({ featured: true });
    const selectedOriginal = structuredClone(
      (await getSubmission(selected.id, selected.actor)).input,
    );
    await reviewSubmission(selected.id, review({ featured: true }), reviewer);
    assert.equal((await getPublicContribution(selected.id))!.featured, true);
    assert.equal(
      (await readStoreArchive(store)).contributions.find((entry) => entry.id === selected.id)!
        .featured,
      true,
    );
    assert.deepEqual((await getSubmission(selected.id, selected.actor)).input, selectedOriginal);
    assert.equal('featured' in selectedOriginal, false);
    const saved = await store.query<{ input: Record<string, unknown> }>(
      'SELECT input FROM community.submissions WHERE id=$1',
      [selected.id],
    );
    assert.equal('featured' in saved.rows[0]!.input, false);
    const decisions = await store.query<{ decision: { featured?: boolean } }>(
      'SELECT decision FROM community.reviews WHERE submission_id=$1',
      [selected.id],
    );
    assert.equal(decisions.rows[0]!.decision.featured, true);
    await reviewSubmission(selected.id, review({ featured: false }), reviewer);
    assert.equal(
      (await getPublicContribution(selected.id))!.featured,
      true,
      'retrying an already completed publication does not silently edit it',
    );
    await reviewSubmission(selected.id, review({ action: 'withdraw' }), reviewer);
    assert.equal(await getPublicContribution(selected.id), null);
  } finally {
    setStoreForTests(undefined);
    await store.close();
    if (previousMode === undefined) delete process.env.ARCHIVE_DATA_MODE;
    else process.env.ARCHIVE_DATA_MODE = previousMode;
  }
});

test('multi-subject contribution lifecycle is durable, reviewed and isolated from public data until publication', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'southview-discovery-test-'));
  const previousMode = process.env.ARCHIVE_DATA_MODE;
  process.env.ARCHIVE_DATA_MODE = 'local';
  let store = await createStore({ mode: 'local', path: join(directory, 'db') });
  setStoreForTests(store);
  try {
    const initial = await readStoreArchive(store);
    const firstPlace = initial.places[0]!.id;
    const secondPlace = initial.places[1]!.id;
    const sourceId = initial.sources[0]!.id;
    await t.test('unknown linked IDs fail create, update and publication atomically', async () => {
      const token = randomUUID() + randomUUID();
      await assert.rejects(
        createDraft(input({ relatedPersonIds: ['missing-person'] }), guest, token),
        { code: 'BAD_REQUEST' },
      );
      await assert.rejects(createDraft(input({ placeIds: ['missing-place'] }), guest, token), {
        code: 'BAD_REQUEST',
      });
      assert.equal((await store.query('SELECT id FROM community.submissions')).rows.length, 0);
      const original = input({ relatedPersonIds: ['alonzo-herndon'], placeIds: [firstPlace] });
      const created = await createDraft(original, guest, token);
      const actor = { ...guest, receiptToken: token };
      await assert.rejects(
        updateDraft(created.submission.id, { ...original, placeIds: ['missing-place'] }, actor),
        { code: 'BAD_REQUEST' },
      );
      assert.deepEqual((await getSubmission(created.submission.id, actor)).input.placeIds, [
        firstPlace,
      ]);
      await finalizeSubmission(created.submission.id, actor);
      await assert.rejects(
        reviewSubmission(
          created.submission.id,
          review({ relatedPersonIds: ['missing-person'] }),
          reviewer,
        ),
        { code: 'BAD_REQUEST' },
      );
      await assert.rejects(
        reviewSubmission(created.submission.id, review({ placeIds: ['missing-place'] }), reviewer),
        { code: 'BAD_REQUEST' },
      );
      assert.equal((await getSubmission(created.submission.id, actor)).status, 'pending');
      assert.equal((await getSubmission(created.submission.id, reviewer)).reviews.length, 0);
      assert.equal(await getPublicContribution(created.submission.id), null);
      assert.equal((await readStoreArchive(store)).contributions.length, 0);
      assert.ok(
        !(await readStoreArchive(store)).credits.some(
          (credit) => credit.id === `contributor-${created.submission.id}`,
        ),
      );
    });
    await t.test(
      'reviewer chooses links and date without changing the original or secondary biographies',
      async () => {
        const original = input({
          relatedPersonIds: ['alonzo-herndon', 'martin-luther-king-sr'],
          placeIds: [firstPlace],
          eventDate: { kind: 'approximate', year: 1960 },
        });
        const token = randomUUID() + randomUUID();
        const actor = { ...guest, receiptToken: token };
        const created = await createDraft(original, guest, token);
        await finalizeSubmission(created.submission.id, actor);
        const pending = JSON.stringify(await readStoreArchive(store));
        assert.ok(!pending.includes(original.body));
        assert.ok(!pending.includes(original.email));
        await assert.rejects(reviewSubmission(created.submission.id, review(), actor), {
          code: 'FORBIDDEN',
        });
        await reviewSubmission(
          created.submission.id,
          review({
            relatedPersonIds: ['john-lewis', 'martin-luther-king-sr', 'martin-luther-king-sr'],
            placeIds: [secondPlace],
            eventDate: { kind: 'range', startYear: 1959, endYear: 1965 },
            applyTo: 'biography',
            sourceIds: [sourceId],
          }),
          reviewer,
        );
        const published = (await getPublicContribution(created.submission.id))!;
        assert.deepEqual(published.relatedPersonIds, ['martin-luther-king-sr']);
        assert.deepEqual(published.placeIds, [secondPlace]);
        assert.deepEqual(published.eventDate, { kind: 'range', startYear: 1959, endYear: 1965 });
        assert.equal(published.personId, 'john-lewis');
        assert.equal(published.creditId, `contributor-${created.submission.id}`);
        assert.ok(published.sourceIds.includes(sourceId));
        assert.deepEqual((await getSubmission(created.submission.id, actor)).input, original);
        const after = await readStoreArchive(store);
        for (const id of ['alonzo-herndon', 'martin-luther-king-sr'])
          assert.deepEqual(
            after.people.find((person) => person.id === id),
            initial.people.find((person) => person.id === id),
          );
        assert.ok(!JSON.stringify(after).includes(original.privateName));
        assert.ok(!JSON.stringify(after).includes(original.email));
        await store.close();
        store = await createStore({ mode: 'local', path: join(directory, 'db') });
        setStoreForTests(store);
        assert.deepEqual(
          (await getPublicContribution(created.submission.id))!.eventDate,
          published.eventDate,
        );
        assert.deepEqual((await getSubmission(created.submission.id, actor)).input, original);
        await reviewSubmission(created.submission.id, review({ action: 'withdraw' }), reviewer);
        assert.equal(await getPublicContribution(created.submission.id), null);
        assert.deepEqual(
          (await readStoreArchive(store)).people.find((person) => person.id === 'john-lewis'),
          initial.people.find((person) => person.id === 'john-lewis'),
        );
      },
    );
    await t.test(
      'omitted review metadata inherits the original; explicit empty values remove links and date',
      async () => {
        const keep = await submitted({
          relatedPersonIds: ['alonzo-herndon'],
          placeIds: [firstPlace],
          eventDate: { kind: 'year', year: 1963 },
        });
        await reviewSubmission(keep.id, review(), reviewer);
        const kept = (await getPublicContribution(keep.id))!;
        assert.deepEqual(kept.relatedPersonIds, ['alonzo-herndon']);
        assert.deepEqual(kept.placeIds, [firstPlace]);
        assert.deepEqual(kept.eventDate, { kind: 'year', year: 1963 });
        const clear = await submitted({
          relatedPersonIds: ['alonzo-herndon'],
          placeIds: [firstPlace],
          eventDate: { kind: 'year', year: 1963 },
        });
        await reviewSubmission(
          clear.id,
          review({ relatedPersonIds: [], placeIds: [], eventDate: { kind: 'unknown' } }),
          reviewer,
        );
        const cleared = (await getPublicContribution(clear.id))!;
        assert.deepEqual(cleared.relatedPersonIds, []);
        assert.deepEqual(cleared.placeIds, []);
        assert.deepEqual(cleared.eventDate, { kind: 'unknown' });
      },
    );
    await t.test(
      'legacy stored submissions and public payloads get read defaults without rewriting originals',
      async () => {
        const legacy = await submitted();
        await store.query(
          "UPDATE community.submissions SET input=input-'relatedPersonIds'-'placeIds'-'eventDate' WHERE id=$1",
          [legacy.id],
        );
        const before = (
          await store.query<{ input: Record<string, unknown> }>(
            'SELECT input FROM community.submissions WHERE id=$1',
            [legacy.id],
          )
        ).rows[0]!.input;
        const restored = await getSubmission(legacy.id, legacy.actor);
        assert.deepEqual(restored.input.eventDate, { kind: 'unknown' });
        assert.deepEqual(restored.input.relatedPersonIds, []);
        await reviewSubmission(legacy.id, review(), reviewer);
        await store.query(
          "UPDATE archive.contributions SET data=data-'relatedPersonIds'-'placeIds'-'eventDate' WHERE id=$1",
          [legacy.id],
        );
        assert.deepEqual((await getPublicContribution(legacy.id))!.eventDate, { kind: 'unknown' });
        assert.deepEqual(
          (await readStoreArchive(store)).contributions.find((entry) => entry.id === legacy.id)!
            .relatedPersonIds,
          [],
        );
        const after = (
          await store.query<{ input: Record<string, unknown> }>(
            'SELECT input FROM community.submissions WHERE id=$1',
            [legacy.id],
          )
        ).rows[0]!.input;
        assert.deepEqual(after, before);
      },
    );
    await t.test(
      'withdrawal cannot delete people or places linked by another public contribution',
      async () => {
        const creator = await submitted({
          kind: 'new-person',
          personId: null,
          proposedPersonName: 'A separately documented resident',
        });
        await reviewSubmission(
          creator.id,
          review({ newPersonName: 'A separately documented resident' }),
          reviewer,
        );
        const personId = (await getPublicContribution(creator.id))!.personId;
        const dependent = await submitted({ relatedPersonIds: [personId] });
        await reviewSubmission(dependent.id, review(), reviewer);
        await assert.rejects(
          reviewSubmission(creator.id, review({ action: 'withdraw' }), reviewer),
          { code: 'CONFLICT' },
        );
        assert.ok(await getPublicContribution(creator.id));
        assert.ok((await readStoreArchive(store)).people.some((person) => person.id === personId));
        await reviewSubmission(dependent.id, review({ action: 'withdraw' }), reviewer);
        await reviewSubmission(creator.id, review({ action: 'withdraw' }), reviewer);
        assert.ok(!(await readStoreArchive(store)).people.some((person) => person.id === personId));
        const placeCreator = await submitted();
        const placeId = `place-${placeCreator.id}`;
        await reviewSubmission(
          placeCreator.id,
          review({
            applyTo: 'place',
            placeIds: [placeId],
            sourceIds: [sourceId],
            placePatch: {
              placeId,
              name: 'A documented gathering place',
              scope: 'atlanta',
              coordinates: null,
              precision: 'unmapped',
              locationNote: 'The exact position is unknown.',
              relationship: 'Gathered here',
            },
          }),
          reviewer,
        );
        const placeDependent = await submitted({ placeIds: [placeId] });
        await reviewSubmission(placeDependent.id, review(), reviewer);
        await assert.rejects(
          reviewSubmission(placeCreator.id, review({ action: 'withdraw' }), reviewer),
          { code: 'CONFLICT' },
        );
        assert.ok((await readStoreArchive(store)).places.some((place) => place.id === placeId));
        await reviewSubmission(placeDependent.id, review({ action: 'withdraw' }), reviewer);
        await reviewSubmission(placeCreator.id, review({ action: 'withdraw' }), reviewer);
        assert.ok(!(await readStoreArchive(store)).places.some((place) => place.id === placeId));
      },
    );
  } finally {
    setStoreForTests(undefined);
    await store.close();
    if (previousMode === undefined) delete process.env.ARCHIVE_DATA_MODE;
    else process.env.ARCHIVE_DATA_MODE = previousMode;
    assert.ok(
      resolve(directory).startsWith(resolve(tmpdir()) + '\\') ||
        resolve(directory).startsWith(resolve(tmpdir()) + '/'),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
