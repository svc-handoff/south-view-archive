import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createStore, setStoreForTests } from '../packages/db/src/connection';
import { getArchive } from '../packages/db/src/index';
import {
  createDraft,
  finalizeSubmission,
  getPublicContribution,
  getSubmission,
  reviewSubmission,
  updateDraft,
} from '../packages/db/src/community';
import {
  createMaterial,
  editContribution,
  editMaterial,
  editPlace,
  removeLink,
  removeMaterial,
  undoStaffEdit,
} from '../packages/db/src/staff-edits';
import {
  reviewInputSchema,
  submissionInputSchema,
  type Actor,
  type Place,
} from '../packages/validators/src/index';

// Fixture graves at South-View, each with one person buried there, and places in Atlanta.
const lewisGrave = 'lewis-south-view'; // John Lewis
const kingCrypt = 'king-sr-south-view'; // Martin Luther King Sr., "King family crypt"
const herndonGrave = 'herndon-south-view'; // Alonzo Herndon
const cityHall = 'atlanta-city-hall';
const ebenezer = 'ebenezer-heritage';

const guest: Actor = { userId: null, email: null, reviewer: false };
const reviewer: Actor = {
  userId: 'grave-guard-reviewer',
  email: 'reviewer@example.org',
  reviewer: true,
};
const graveRefusal =
  /is a grave at South-View, so it can only be a related place of someone buried there\.$/;
const newPerson = {
  kind: 'new-person',
  personId: null,
  proposedPersonName: 'A newly remembered neighbor',
};

function story(overrides: Record<string, unknown> = {}) {
  return submissionInputSchema.parse({
    clientRequestId: randomUUID(),
    kind: 'addition',
    personId: 'john-lewis',
    proposedPersonName: '',
    title: 'Places remembered',
    body: 'A community account of the places in this life, supplied for human review.',
    links: [],
    privateName: 'Private Name',
    email: 'private@example.org',
    anonymous: true,
    displayName: '',
    permission: true,
    ...overrides,
  });
}
const receipt = () => randomUUID() + randomUUID();
async function submitted(overrides: Record<string, unknown> = {}) {
  const token = receipt();
  const { submission } = await createDraft(story(overrides), guest, token);
  await finalizeSubmission(submission.id, { ...guest, receiptToken: token });
  return submission.id;
}
const publish = (id: string, review: Record<string, unknown> = {}) =>
  reviewSubmission(id, reviewInputSchema.parse({ action: 'publish', ...review }), reviewer);
const withdraw = (id: string) =>
  reviewSubmission(id, reviewInputSchema.parse({ action: 'withdraw' }), reviewer);
/** A map place update that rewrites a place's position and note, keeping its name and area. */
function placePatch(
  place: Pick<Place, 'id' | 'name' | 'scope'>,
  relationship = 'Remembered at South-View',
) {
  return {
    placeId: place.id,
    name: place.name,
    scope: place.scope,
    coordinates: [-84.3745, 33.7021],
    precision: 'reference',
    locationNote: 'Moved by a contributor; reference position.',
    relationship,
  };
}

test('a grave at South-View is a related place only of the people buried there', async (t) => {
  const previousMode = process.env.ARCHIVE_DATA_MODE;
  delete process.env.ARCHIVE_DATA_MODE;
  const store = await createStore({ mode: 'local', path: 'memory://' });
  setStoreForTests(store);
  try {
    await t.test(
      'a record about John Lewis may list his grave and places in Atlanta, not another person’s grave',
      async () => {
        const archive = await getArchive();
        const sourceId = archive.people.find((person) => person.id === 'john-lewis')!
          .summaryCitations[0]!.sourceId;
        const record = (placeIds: string[]) => ({
          material: {
            kind: 'document' as const,
            title: 'A record of his places',
            description: 'A record that names the places of this life.',
            narrator: '',
            interviewer: '',
            date: '',
            eventDate: { kind: 'unknown' as const },
            relatedPersonIds: [],
            placeIds,
          },
          source: { mode: 'existing' as const, sourceId },
          reason: 'Adding a record',
        });
        await assert.rejects(
          createMaterial({ personId: 'john-lewis', ...record([cityHall, kingCrypt]) }, reviewer),
          {
            code: 'BAD_REQUEST',
            message:
              'King family crypt is a grave at South-View, so it can only be a related place of someone buried there.',
          },
        );
        const created = await createMaterial(
          { personId: 'john-lewis', ...record([lewisGrave, cityHall]) },
          reviewer,
        );
        assert.deepEqual(created.material.placeIds, [lewisGrave, cityHall]);
        await assert.rejects(editMaterial(created.material.id, record([herndonGrave]), reviewer), {
          code: 'BAD_REQUEST',
          message: graveRefusal,
        });
        assert.deepEqual(
          (await getArchive()).materials.find((item) => item.id === created.material.id)!.placeIds,
          [lewisGrave, cityHall],
        );
        // A record about King Sr. may list his own crypt.
        const king = await createMaterial(
          { personId: 'martin-luther-king-sr', ...record([kingCrypt, ebenezer]) },
          reviewer,
        );
        await removeMaterial(king.material.id, 'Clean up', reviewer);
        await removeMaterial(created.material.id, 'Clean up', reviewer);
      },
    );

    await t.test(
      'a story about John Lewis may list his grave and places in Atlanta, at every step of a draft',
      async () => {
        const token = receipt();
        const author = { ...guest, receiptToken: token };
        await assert.rejects(
          createDraft(story({ placeIds: [lewisGrave, kingCrypt] }), guest, token),
          {
            code: 'BAD_REQUEST',
            message: graveRefusal,
          },
        );
        assert.equal((await store.query('SELECT id FROM community.submissions')).rows.length, 0);
        const original = story({ placeIds: [lewisGrave, cityHall] });
        const { submission } = await createDraft(original, guest, token);
        await assert.rejects(
          updateDraft(submission.id, { ...original, placeIds: [cityHall, herndonGrave] }, author),
          { code: 'BAD_REQUEST', message: /^Alonzo Herndon is a grave at South-View/ },
        );
        assert.deepEqual((await getSubmission(submission.id, author)).input.placeIds, [
          lewisGrave,
          cityHall,
        ]);
        await updateDraft(submission.id, { ...original, placeIds: [lewisGrave, ebenezer] }, author);
        await finalizeSubmission(submission.id, author);
        assert.equal((await getSubmission(submission.id, author)).status, 'pending');

        // A draft saved before the rule cannot be sent while it lists another person's grave.
        const legacyToken = receipt();
        const { submission: legacy } = await createDraft(story(), guest, legacyToken);
        await store.query(
          `UPDATE community.submissions SET input = jsonb_set(input, '{placeIds}', $2::jsonb) WHERE id = $1`,
          [legacy.id, JSON.stringify([kingCrypt])],
        );
        await assert.rejects(
          finalizeSubmission(legacy.id, { ...guest, receiptToken: legacyToken }),
          {
            code: 'BAD_REQUEST',
            message: graveRefusal,
          },
        );
        assert.equal(
          (await getSubmission(legacy.id, { ...guest, receiptToken: legacyToken })).status,
          'draft',
        );
      },
    );

    await t.test('a story about a proposed new person may not list any grave', async () => {
      for (const grave of [lewisGrave, kingCrypt, herndonGrave])
        await assert.rejects(
          createDraft(story({ ...newPerson, placeIds: [cityHall, grave] }), guest, receipt()),
          { code: 'BAD_REQUEST', message: graveRefusal },
        );
      const id = await submitted({ ...newPerson, placeIds: [ebenezer] });
      await assert.rejects(
        publish(id, {
          newPersonName: newPerson.proposedPersonName,
          placeIds: [ebenezer, lewisGrave],
        }),
        { code: 'BAD_REQUEST', message: /^John Lewis is a grave at South-View/ },
      );
      assert.equal((await getSubmission(id, reviewer)).reviews.length, 0);
      assert.equal((await getArchive()).people.length, 3);
      // The grave a new person's story creates is theirs from the start.
      const graveId = `community-place-${id}`;
      await publish(id, {
        newPersonName: newPerson.proposedPersonName,
        placeIds: [ebenezer, graveId],
        applyTo: 'place',
        placePatch: {
          placeId: graveId,
          name: `Grave of ${newPerson.proposedPersonName}`,
          scope: 'cemetery',
          coordinates: null,
          precision: 'unmapped',
          locationNote: 'No position is known yet.',
          relationship: 'Buried here',
        },
      });
      assert.deepEqual((await getPublicContribution(id))!.placeIds, [ebenezer, graveId]);
      await withdraw(id);
      const after = await getArchive();
      assert.equal(after.people.length, 3);
      assert.ok(!after.places.some((place) => place.id === graveId));
    });

    await t.test(
      'publication checks the places mentioned against the person it is published under',
      async () => {
        const id = await submitted({ placeIds: [lewisGrave, cityHall] });
        // Moved to King Sr., the story can no longer mention Lewis's grave.
        await assert.rejects(publish(id, { personId: 'martin-luther-king-sr' }), {
          code: 'BAD_REQUEST',
          message: /^John Lewis is a grave at South-View/,
        });
        await assert.rejects(publish(id, { placeIds: [cityHall, herndonGrave] }), {
          code: 'BAD_REQUEST',
          message: /^Alonzo Herndon is a grave at South-View/,
        });
        assert.equal((await getSubmission(id, reviewer)).status, 'pending');
        await publish(id, { personId: 'martin-luther-king-sr', placeIds: [kingCrypt, cityHall] });
        const entry = (await getPublicContribution(id))!;
        assert.equal(entry.personId, 'martin-luther-king-sr');
        assert.deepEqual(entry.placeIds, [kingCrypt, cityHall]);
        // Staff corrections to the published entry follow the same rule.
        await assert.rejects(
          editContribution(
            id,
            { patch: { placeIds: [kingCrypt, lewisGrave] }, reason: 'Adding a place' },
            reviewer,
          ),
          { code: 'BAD_REQUEST', message: /^John Lewis is a grave at South-View/ },
        );
        await editContribution(
          id,
          { patch: { placeIds: [kingCrypt, ebenezer] }, reason: 'Correcting the places' },
          reviewer,
        );
        assert.deepEqual((await getPublicContribution(id))!.placeIds, [kingCrypt, ebenezer]);
        await withdraw(id);
      },
    );

    await t.test(
      'a map place update may change the person’s own grave, never another person’s',
      async () => {
        const before = await getArchive();
        const crypt = before.places.find((place) => place.id === kingCrypt)!;
        const grave = before.places.find((place) => place.id === lewisGrave)!;
        const cryptRelations = before.relations.filter((item) => item.placeId === kingCrypt);
        const belongsToKing =
          'That grave belongs to Martin Luther King Sr. Choose this person’s grave or a place in Atlanta.';

        const lewisStory = await submitted();
        await assert.rejects(
          publish(lewisStory, { applyTo: 'place', placePatch: placePatch(crypt) }),
          {
            code: 'BAD_REQUEST',
            message: belongsToKing,
          },
        );
        // A reviewer who moves King Sr.'s story to another person cannot take his crypt along.
        const kingStory = await submitted({
          personId: 'martin-luther-king-sr',
          placeIds: [kingCrypt],
        });
        await assert.rejects(
          publish(kingStory, {
            personId: 'john-lewis',
            applyTo: 'place',
            placePatch: placePatch(crypt),
          }),
          { code: 'BAD_REQUEST', message: belongsToKing },
        );
        // Nor can a story about a new person.
        const newStory = await submitted(newPerson);
        await assert.rejects(
          publish(newStory, {
            newPersonName: newPerson.proposedPersonName,
            applyTo: 'place',
            placePatch: placePatch(grave),
          }),
          {
            code: 'BAD_REQUEST',
            message:
              'That grave belongs to John Lewis. Choose this person’s grave or a place in Atlanta.',
          },
        );
        let after = await getArchive();
        assert.deepEqual(
          after.places.find((place) => place.id === kingCrypt),
          crypt,
        );
        assert.deepEqual(
          after.relations.filter((item) => item.placeId === kingCrypt),
          cryptRelations,
        );
        assert.equal(after.people.length, 3);
        for (const id of [lewisStory, kingStory, newStory])
          assert.equal((await getSubmission(id, reviewer)).status, 'pending');

        // The person's own grave can still be updated, and the update withdraws cleanly.
        await publish(lewisStory, {
          applyTo: 'place',
          placeIds: [lewisGrave],
          placePatch: placePatch(grave),
        });
        after = await getArchive();
        assert.deepEqual(
          after.places.find((place) => place.id === lewisGrave)!.coordinates,
          [-84.3745, 33.7021],
        );
        assert.deepEqual(
          after.places.find((place) => place.id === kingCrypt),
          crypt,
        );
        await withdraw(lewisStory);
        assert.deepEqual(
          (await getArchive()).places.find((place) => place.id === lewisGrave),
          grave,
        );

        // King Sr.'s own story may update his crypt.
        await publish(kingStory, { applyTo: 'place', placePatch: placePatch(crypt) });
        assert.deepEqual(
          (await getArchive()).places.find((place) => place.id === kingCrypt)!.coordinates,
          [-84.3745, 33.7021],
        );
        await withdraw(kingStory);
        assert.deepEqual(
          (await getArchive()).places.find((place) => place.id === kingCrypt),
          crypt,
        );
      },
    );

    await t.test(
      'a grave no one is connected to yet may be taken up by a map place update',
      async () => {
        const unclaimed = {
          id: 'unclaimed-grave',
          name: 'Burial Site',
          scope: 'cemetery' as const,
          coordinates: null,
          precision: 'unmapped',
          locationNote: 'No position is known.',
          coordinateCitations: [],
        };
        await store.query('INSERT INTO archive.places (id, data) VALUES ($1, $2::jsonb)', [
          unclaimed.id,
          JSON.stringify(unclaimed),
        ]);
        // Until then it is nobody's grave, so no story lists it as a related place.
        await assert.rejects(createDraft(story({ placeIds: [unclaimed.id] }), guest, receipt()), {
          code: 'BAD_REQUEST',
          message: /^Burial Site is a grave at South-View/,
        });
        const id = await submitted();
        await publish(id, {
          applyTo: 'place',
          placePatch: placePatch(unclaimed, 'Buried here'),
        });
        const linked = (await getArchive()).relations.filter(
          (item) => item.placeId === unclaimed.id,
        );
        assert.deepEqual(
          linked.map((item) => item.personId),
          ['john-lewis'],
        );
        await withdraw(id);
        assert.ok(!(await getArchive()).relations.some((item) => item.placeId === unclaimed.id));
        await store.query('DELETE FROM archive.places WHERE id = $1', [unclaimed.id]);
      },
    );
  } finally {
    setStoreForTests(undefined);
    await store.close();
    if (previousMode === undefined) delete process.env.ARCHIVE_DATA_MODE;
    else process.env.ARCHIVE_DATA_MODE = previousMode;
  }
});

test('a grave stays a grave and a place stays a place, whatever a request says', async (t) => {
  const previousMode = process.env.ARCHIVE_DATA_MODE;
  delete process.env.ARCHIVE_DATA_MODE;
  const store = await createStore({ mode: 'local', path: 'memory://' });
  setStoreForTests(store);
  try {
    await t.test('a map place update keeps an existing place’s area', async () => {
      const before = await getArchive();
      const hall = before.places.find((place) => place.id === cityHall)!;
      const grave = before.places.find((place) => place.id === lewisGrave)!;
      // A request that would turn City Hall into a grave keeps it a place in Atlanta.
      const toGrave = await submitted({ placeIds: [cityHall] });
      await publish(toGrave, {
        applyTo: 'place',
        placePatch: { ...placePatch(hall, 'Worked here'), scope: 'cemetery' },
      });
      assert.equal(
        (await getArchive()).places.find((place) => place.id === cityHall)!.scope,
        'atlanta',
      );
      await withdraw(toGrave);
      // And one that would turn Lewis's own grave into a place keeps it his grave.
      const toPlace = await submitted({ placeIds: [lewisGrave] });
      await publish(toPlace, {
        applyTo: 'place',
        placePatch: { ...placePatch(grave), scope: 'atlanta' },
      });
      assert.equal(
        (await getArchive()).places.find((place) => place.id === lewisGrave)!.scope,
        'cemetery',
      );
      await withdraw(toPlace);
    });

    await t.test('a staff place correction cannot change the area', async () => {
      const edited = await editPlace(
        cityHall,
        { patch: { name: 'Atlanta City Hall', scope: 'cemetery' }, reason: 'Testing' } as never,
        reviewer,
      );
      assert.equal(edited.place.scope, 'atlanta');
    });

    await t.test('an undo never puts someone else’s grave back on a record', async () => {
      const archive = await getArchive();
      const sourceId = archive.people.find((person) => person.id === 'john-lewis')!
        .summaryCitations[0]!.sourceId;
      const material = (placeIds: string[]) => ({
        material: {
          kind: 'document' as const,
          title: 'A record of his grave',
          description: 'A record that names his grave.',
          narrator: '',
          interviewer: '',
          date: '',
          eventDate: { kind: 'unknown' as const },
          relatedPersonIds: [],
          placeIds,
        },
        source: { mode: 'existing' as const, sourceId },
        reason: 'Adding a record',
      });
      const created = await createMaterial(
        { personId: 'john-lewis', ...material([lewisGrave]) },
        reviewer,
      );
      const cleared = await editMaterial(created.material.id, material([]), reviewer);
      // Lewis is no longer connected to that grave, so it is nobody's he may cite.
      const burial = archive.relations.find(
        (item) => item.personId === 'john-lewis' && item.placeId === lewisGrave,
      )!;
      const unlinked = await removeLink(burial.id, 'Testing', reviewer);
      await assert.rejects(undoStaffEdit(cleared.edits[0]!.id, 'Put it back', reviewer), {
        code: 'BAD_REQUEST',
        message: graveRefusal,
      });
      assert.deepEqual(
        (await getArchive()).materials.find((item) => item.id === created.material.id)!.placeIds,
        [],
      );
      // With the burial connection back, the same undo goes through.
      await undoStaffEdit(unlinked.edits[0]!.id, 'Restore', reviewer);
      await undoStaffEdit(cleared.edits[0]!.id, 'Put it back', reviewer);
      assert.deepEqual(
        (await getArchive()).materials.find((item) => item.id === created.material.id)!.placeIds,
        [lewisGrave],
      );
      await removeMaterial(created.material.id, 'Clean up', reviewer);
    });
  } finally {
    setStoreForTests(undefined);
    await store.close();
    if (previousMode === undefined) delete process.env.ARCHIVE_DATA_MODE;
    else process.env.ARCHIVE_DATA_MODE = previousMode;
  }
});
