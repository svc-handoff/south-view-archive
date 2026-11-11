import assert from 'node:assert/strict';
import test from 'node:test';
import { createStore, setStoreForTests } from '../packages/db/src/connection';
import { getArchive } from '../packages/db/src/index';
import { fixtureArchive } from '../packages/db/src/fixtures';
import { createLink, mapBurial, undoStaffEdit } from '../packages/db/src/staff-edits';
import {
  canRelatePlace,
  graveOccupants,
  graveTitle,
  isGrave,
  personGraves,
  relatedPlaceOptions,
  safeCommunityNext,
  type Actor,
} from '../packages/validators/src/index';
import { adminRecordUrl, parseAdminPath } from '../apps/nextjs/src/lib/review-state';

const reviewer: Actor = { userId: 'staff-reviewer', email: 'reviewer@example.org', reviewer: true };
const data = {
  places: [
    { id: 'grave-a', scope: 'cemetery' as const },
    { id: 'crypt', scope: 'cemetery' as const },
    { id: 'church', scope: 'atlanta' as const },
  ],
  relations: [
    { personId: 'a', placeId: 'grave-a' },
    { personId: 'a', placeId: 'church' },
    { personId: 'b', placeId: 'crypt' },
    { personId: 'c', placeId: 'crypt' },
    { personId: 'c', placeId: 'crypt' },
  ],
};

test('a place at South-View is a grave, and belongs to the people buried there', () => {
  assert.equal(isGrave({ scope: 'cemetery' }), true);
  assert.equal(isGrave({ scope: 'atlanta' }), false);
  assert.deepEqual(graveOccupants(data, 'crypt'), ['b', 'c']);
  assert.deepEqual(
    personGraves(data, 'a').map((place) => place.id),
    ['grave-a'],
  );
  assert.deepEqual(personGraves(data, 'nobody'), []);
});

test('pickers offer places in Atlanta and only the person’s own grave', () => {
  assert.equal(canRelatePlace(data, 'church', 'b'), true);
  assert.equal(canRelatePlace(data, 'grave-a', 'a'), true);
  assert.equal(canRelatePlace(data, 'grave-a', 'b'), false);
  assert.equal(canRelatePlace(data, 'crypt', 'c'), true);
  assert.equal(canRelatePlace(data, 'crypt', null), false);
  assert.deepEqual(
    relatedPlaceOptions(data, 'b').map((place) => place.id),
    ['crypt', 'church'],
  );
  // Someone else's grave stays only while it is already chosen, so nothing is dropped unseen.
  assert.deepEqual(
    relatedPlaceOptions(data, 'b', ['grave-a']).map((place) => place.id),
    ['grave-a', 'crypt', 'church'],
  );
  assert.deepEqual(
    relatedPlaceOptions(data, null).map((place) => place.id),
    ['church'],
  );
});

test('a grave is named by its people', () => {
  assert.equal(graveTitle(['John Lewis']), 'Grave of John Lewis');
  assert.equal(graveTitle(['A', 'B']), 'Grave of A and B');
  assert.equal(graveTitle(['A', 'B', 'C']), 'Grave of A, B and C');
  assert.equal(graveTitle([]), 'Grave with no one connected');
});

test('graves have their own admin address and sign-in return', () => {
  assert.equal(adminRecordUrl('graves', 'king-sr-south-view'), '/admin/graves/king-sr-south-view');
  assert.deepEqual(parseAdminPath('/admin/graves/king-sr-south-view'), {
    tab: 'graves',
    recordId: 'king-sr-south-view',
  });
  assert.deepEqual(parseAdminPath('/admin/graves'), { tab: 'graves', recordId: null });
  assert.equal(
    safeCommunityNext('/admin/graves/lewis-south-view'),
    '/admin/graves/lewis-south-view',
  );
  // The fixture graves are exactly the cemetery places.
  assert.deepEqual(
    fixtureArchive.places.filter(isGrave).map((place) => place.id),
    ['lewis-south-view', 'king-sr-south-view', 'herndon-south-view'],
  );
});

test('staff connect graves only as burials, and places only as places', async (t) => {
  const previousMode = process.env.ARCHIVE_DATA_MODE;
  delete process.env.ARCHIVE_DATA_MODE;
  const store = await createStore({ mode: 'local', path: 'memory://' });
  setStoreForTests(store);
  try {
    const sourceId = fixtureArchive.sources[0]!.id;
    await t.test('someone else’s grave is not a place from a life', async () => {
      await assert.rejects(
        createLink(
          {
            personId: 'alonzo-herndon',
            placeId: 'lewis-south-view',
            label: 'Visited',
            sourceId,
            reason: 'Linking',
          },
          reviewer,
        ),
        { code: 'BAD_REQUEST', message: /grave at South-View/ },
      );
      await assert.rejects(
        createLink(
          {
            personId: 'alonzo-herndon',
            placeId: 'atlanta-city-hall',
            label: 'Buried here',
            sourceId,
            burial: true,
            reason: 'Linking',
          },
          reviewer,
        ),
        { code: 'BAD_REQUEST', message: /Choose a grave/ },
      );
    });
    await t.test('a second person buried in a shared crypt joins it', async () => {
      const joined = await createLink(
        {
          personId: 'alonzo-herndon',
          placeId: 'king-sr-south-view',
          label: 'Buried here',
          sourceId,
          burial: true,
          reason: 'Shared crypt',
        },
        reviewer,
      );
      assert.deepEqual(graveOccupants(await getArchive(), 'king-sr-south-view'), [
        'martin-luther-king-sr',
        'alonzo-herndon',
      ]);
      await undoStaffEdit(joined.edits[0]!.id, 'Test only', reviewer);
    });
    await t.test('a grave added at the grave is named after the person', async () => {
      const removedLinks = (await getArchive()).relations.filter(
        (item) => item.personId === 'alonzo-herndon' && item.placeId === 'herndon-south-view',
      );
      assert.equal(removedLinks.length, 1);
      const { removeLink } = await import('../packages/db/src/staff-edits');
      const removed = await removeLink(removedLinks[0]!.id, 'Testing', reviewer);
      const added = await mapBurial(
        'alonzo-herndon',
        { coordinates: [-84.3712, 33.7003], accuracy: 4, reason: 'Measured at the grave' },
        reviewer,
      );
      assert.equal(added.place.name, 'Grave of Alonzo Herndon');
      await undoStaffEdit(added.edits[0]!.id, 'Back', reviewer);
      await undoStaffEdit(removed.edits[0]!.id, 'Back', reviewer);
    });
  } finally {
    setStoreForTests(undefined);
    await store.close();
    if (previousMode === undefined) delete process.env.ARCHIVE_DATA_MODE;
    else process.env.ARCHIVE_DATA_MODE = previousMode;
  }
});
