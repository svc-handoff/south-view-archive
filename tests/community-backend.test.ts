import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createStore, setStoreForTests } from '../packages/db/src/connection';
import { getArchive } from '../packages/db/src/index';
import { readStoreArchive } from '../packages/db/src/database';
import {
  createDraft,
  updateDraft,
  attachPhoto,
  removePhoto,
  finalizeSubmission,
  getSubmission,
  listSubmissions,
  listReviewSubmissions,
  addSupplement,
  claimSubmission,
  reviewSubmission,
  getPublicPhoto,
  getPublicContribution,
  consumeRateLimit,
} from '../packages/db/src/community';
import { editContribution } from '../packages/db/src/staff-edits';
import {
  submissionInputSchema,
  reviewInputSchema,
  type Actor,
  type SubmissionPhoto,
} from '../packages/validators/src/index';

const guest: Actor = { userId: null, email: null, reviewer: false };
const reviewer: Actor = { userId: 'staff-reviewer', email: 'reviewer@example.org', reviewer: true };
function original(overrides: Record<string, unknown> = {}) {
  return submissionInputSchema.parse({
    clientRequestId: randomUUID(),
    kind: 'addition',
    personId: 'john-lewis',
    proposedPersonName: '',
    title: 'A community contribution',
    body: 'This is a community account supplied for human review and archival publication.',
    context: 'Private context to redact before publication',
    sourceCreator: 'Original source creator',
    narrator: 'Original narrator',
    holdingInstitution: 'Original holding institution',
    links: [{ title: 'Contributor reference', url: 'https://example.org/document' }],
    privateName: 'Private Legal Name',
    email: 'private-contact@example.org',
    anonymous: false,
    displayName: 'Public contributor',
    permission: true,
    ...overrides,
  });
}
function token() {
  return randomUUID() + randomUUID();
}
function photo(overrides: Partial<SubmissionPhoto> = {}): SubmissionPhoto {
  return {
    id: randomUUID(),
    originalKey: 'private-original-key',
    publicKey: 'processed-public-key',
    width: 800,
    height: 600,
    mimeType: 'image/jpeg',
    bytes: 5120,
    caption: 'A contributor-supplied photograph',
    creator: 'Photographer',
    rights: 'Used with permission',
    permission: true,
    ...overrides,
  };
}
const decision = (overrides: Record<string, unknown> = {}) =>
  reviewInputSchema.parse({ action: 'publish', ...overrides });

test('community lifecycle isolates private originals, verifies ownership, and publishes a reviewed projection', async (t) => {
  const previousMode = process.env.ARCHIVE_DATA_MODE;
  delete process.env.ARCHIVE_DATA_MODE;
  const store = await createStore({ mode: 'local', path: 'memory://' });
  setStoreForTests(store);
  try {
    await t.test(
      'local initialization seeds once and exposes only the public archive tables',
      async () => {
        const snapshot = await getArchive();
        assert.equal(snapshot.people.length, 3);
        assert.equal(snapshot.credits[0]?.id, 'initial-compilation');
        assert.equal(snapshot.contributions.length, 0);
        const versions = await store.query('SELECT version FROM archive.schema_migrations');
        assert.equal(versions.rows.length, 7);
      },
    );
    await t.test(
      'guest receipt is hashed, scoped, persistent and supports safe create retries',
      async () => {
        const receipt = token();
        const input = original();
        const created = await createDraft(input, guest, receipt);
        assert.equal(created.submission.status, 'draft');
        assert.equal(
          (await createDraft(input, guest, receipt)).submission.id,
          created.submission.id,
        );
        await assert.rejects(createDraft(input, guest, token()), { code: 'NOT_FOUND' });
        await assert.rejects(createDraft({ ...input, title: 'Changed original' }, guest, receipt), {
          code: 'CONFLICT',
        });
        await assert.rejects(getSubmission(created.submission.id, guest), { code: 'NOT_FOUND' });
        await assert.rejects(
          getSubmission(created.submission.id, { ...guest, userId: 'unrelated-account' }),
          { code: 'NOT_FOUND' },
        );
        const raw = (
          await store.query<{ receipt_hash: string }>(
            'SELECT receipt_hash FROM community.submissions WHERE id=$1',
            [created.submission.id],
          )
        ).rows[0]!;
        assert.equal(raw.receipt_hash.length, 64);
        assert.notEqual(raw.receipt_hash, receipt);
        assert.ok(!JSON.stringify(created.submission).includes(receipt));
        const content = (
          await store.query<{ input: Record<string, unknown> }>(
            'SELECT input FROM community.submissions WHERE id=$1',
            [created.submission.id],
          )
        ).rows[0]!.input;
        assert.equal(content.email, undefined);
        assert.equal(content.privateName, undefined);
        const contact = (
          await store.query<{ email: string }>(
            'SELECT email FROM community.contacts WHERE submission_id=$1',
            [created.submission.id],
          )
        ).rows[0]!;
        assert.equal(contact.email, input.email);
        const author = { ...guest, receiptToken: receipt };
        const edited = await updateDraft(
          created.submission.id,
          { ...input, title: 'A corrected draft title' },
          author,
        );
        assert.equal(edited.input.title, 'A corrected draft title');
        const attached = photo();
        await attachPhoto(created.submission.id, attached, author);
        await attachPhoto(created.submission.id, attached, author);
        assert.equal((await getSubmission(created.submission.id, author)).photos.length, 1);
        assert.equal(
          (await removePhoto(created.submission.id, attached.id, author))?.id,
          attached.id,
        );
        await attachPhoto(created.submission.id, attached, author);
        await finalizeSubmission(created.submission.id, author);
        await finalizeSubmission(created.submission.id, author);
        await assert.rejects(updateDraft(created.submission.id, input, author), {
          code: 'CONFLICT',
        });
        await assert.rejects(removePhoto(created.submission.id, attached.id, author), {
          code: 'CONFLICT',
        });
        assert.equal(await getPublicPhoto(attached.id), null);
        const snapshot = await getArchive();
        for (const secret of [
          input.privateName,
          input.email,
          input.body,
          input.context,
          attached.originalKey,
          receipt,
        ])
          assert.ok(!JSON.stringify(snapshot).includes(secret));
      },
    );
    await t.test(
      'staff edits and photo selection publish atomically without changing the submitted original',
      async () => {
        const receipt = token();
        const author = { ...guest, receiptToken: receipt };
        const input = original({ anonymous: true, displayName: '' });
        const { submission } = await createDraft(input, guest, receipt);
        const approved = photo();
        const withheld = photo({ caption: 'Private-sensitive caption' });
        await attachPhoto(submission.id, approved, author);
        await attachPhoto(submission.id, withheld, author);
        await finalizeSubmission(submission.id, author);
        await assert.rejects(reviewSubmission(submission.id, decision(), guest), {
          code: 'FORBIDDEN',
        });
        await assert.rejects(listReviewSubmissions(guest), { code: 'FORBIDDEN' });
        const reviewed = decision({
          body: 'This is the reviewed and redacted public text, with a clear contribution credit.',
          context: 'Public context',
          sourceCreator: 'Reviewed creator',
          narrator: 'Reviewed narrator',
          holdingInstitution: 'Reviewed holding institution',
          approvedPhotoIds: [approved.id],
          photoEdits: [
            {
              id: approved.id,
              caption: 'Reviewed caption',
              creator: 'Reviewed photographer',
              rights: 'Reviewed rights',
            },
          ],
          internalNote: 'PRIVATE STAFF NOTE',
        });
        const result = await reviewSubmission(submission.id, reviewed, reviewer);
        const revisionsBefore = (
          await store.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM community.publication_revisions WHERE submission_id=$1',
            [submission.id],
          )
        ).rows[0]!.count;
        assert.equal(
          (await reviewSubmission(submission.id, reviewed, reviewer)).entryId,
          result.entryId,
        );
        const revisionsAfter = (
          await store.query<{ count: number }>(
            'SELECT count(*)::int AS count FROM community.publication_revisions WHERE submission_id=$1',
            [submission.id],
          )
        ).rows[0]!.count;
        assert.equal(revisionsAfter, revisionsBefore);
        const snapshot = await getArchive();
        const entry = snapshot.contributions.find((item) => item.id === result.entryId)!;
        assert.equal(entry.body, reviewed.body);
        assert.equal(entry.context, 'Public context');
        assert.equal(entry.narrator, 'Reviewed narrator');
        assert.equal(
          snapshot.credits.find((item) => item.id === entry.creditId)!.displayName,
          'Anonymous contributor',
        );
        assert.equal(entry.photos.length, 1);
        assert.equal(entry.photos[0]!.caption, 'Reviewed caption');
        assert.equal(
          snapshot.sources.find((source) => source.id === `contribution-${submission.id}`)?.creator,
          'Reviewed creator',
        );
        assert.ok(await getPublicPhoto(approved.id));
        assert.equal(await getPublicPhoto(withheld.id), null);
        for (const secret of [
          input.privateName,
          input.email,
          input.body,
          input.context,
          withheld.caption,
          'PRIVATE STAFF NOTE',
          approved.originalKey,
        ])
          assert.ok(!JSON.stringify(snapshot).includes(secret));
        const own = await getSubmission(submission.id, author);
        assert.equal(own.input.body, input.body);
        assert.equal(own.photos[0]!.caption, approved.caption);
        assert.equal(own.reviews[0]!.internalNote, undefined);
        assert.equal(own.reviews[0]!.reviewerId, undefined);
        assert.equal(
          (await getSubmission(submission.id, reviewer)).reviews[0]!.internalNote,
          'PRIVATE STAFF NOTE',
        );
        assert.equal((await getPublicContribution(submission.id))?.id, submission.id);
        await reviewSubmission(submission.id, decision({ action: 'withdraw' }), reviewer);
        assert.equal(await getPublicPhoto(approved.id), null);
        assert.equal(await getPublicContribution(submission.id), null);
        const withdrawnSnapshot = await getArchive();
        assert.ok(
          !withdrawnSnapshot.sources.some((item) => item.id === `contribution-${submission.id}`),
        );
        assert.ok(!withdrawnSnapshot.credits.some((item) => item.id === entry.creditId));
        assert.equal((await getSubmission(submission.id, author)).input.body, input.body);
      },
    );
    await t.test(
      'needs-information supplements preserve originals and memories never become biography facts',
      async () => {
        const receipt = token();
        const author = { ...guest, receiptToken: receipt };
        const input = original({ kind: 'memory' });
        const { submission } = await createDraft(input, guest, receipt);
        await finalizeSubmission(submission.id, author);
        await assert.rejects(
          reviewSubmission(submission.id, decision({ applyTo: 'biography' }), reviewer),
          { code: 'BAD_REQUEST' },
        );
        assert.equal((await getSubmission(submission.id, author)).status, 'pending');
        assert.equal((await getSubmission(submission.id, author)).reviews.length, 0);
        await reviewSubmission(
          submission.id,
          decision({
            action: 'needs-information',
            authorMessage: 'Please explain when this happened.',
            internalNote: 'Staff reasoning',
          }),
          reviewer,
        );
        await attachPhoto(submission.id, photo(), author);
        await addSupplement(submission.id, 'This happened during a visit in the 1990s.', author);
        await assert.rejects(addSupplement(submission.id, 'ab', author), { code: 'BAD_REQUEST' });
        await assert.rejects(addSupplement(submission.id, 'x'.repeat(20001), author), {
          code: 'BAD_REQUEST',
        });
        await addSupplement(submission.id, 'Yes', author);
        const current = await getSubmission(submission.id, author);
        assert.equal(current.status, 'pending');
        assert.equal(current.input.body, input.body);
        assert.equal(current.supplements.length, 2);
        await reviewSubmission(submission.id, decision({ approvedPhotoIds: [] }), reviewer);
        assert.equal((await getPublicContribution(submission.id))!.photos.length, 0);
        assert.equal((await getPublicContribution(submission.id))!.kind, 'memory');
        assert.ok(
          !(await getArchive()).people
            .find((person) => person.id === 'john-lewis')!
            .biography.some((paragraph) => paragraph.text === input.body),
        );
      },
    );
    await t.test(
      'claim requires receipt and matching verified email, and listing stays owner-scoped',
      async () => {
        const receipt = token();
        const { submission } = await createDraft(original(), guest, receipt);
        await assert.rejects(
          claimSubmission(submission.id, {
            ...guest,
            userId: 'owner',
            email: 'other@example.org',
            receiptToken: receipt,
          }),
          { code: 'FORBIDDEN' },
        );
        await assert.rejects(
          claimSubmission(submission.id, {
            ...guest,
            userId: 'owner',
            email: 'private-contact@example.org',
            receiptToken: token(),
          }),
          { code: 'NOT_FOUND' },
        );
        const owner = {
          ...guest,
          userId: 'owner',
          email: 'private-contact@example.org',
          receiptToken: receipt,
        };
        await claimSubmission(submission.id, owner);
        await claimSubmission(submission.id, owner);
        assert.equal((await listSubmissions(owner)).length, 1);
        assert.equal((await listSubmissions({ ...guest, userId: 'stranger' })).length, 0);
        await assert.rejects(
          claimSubmission(submission.id, { ...owner, userId: 'other-account' }),
          { code: 'CONFLICT' },
        );
        const limits = await Promise.all(
          Array.from({ length: 12 }, () => consumeRateLimit('private-ip-and-email', 3, 60000)),
        );
        assert.equal(limits.filter(Boolean).length, 3);
        await store.query("UPDATE community.rate_limits SET expires_at=now()-interval '1 second'");
        assert.equal(await consumeRateLimit('private-ip-and-email', 3, 60000), true);
        assert.ok(
          !JSON.stringify((await store.query('SELECT * FROM community.rate_limits')).rows).includes(
            'private-ip-and-email',
          ),
        );
      },
    );
    await t.test(
      'biography updates cite and credit the paragraph; withdrawal restores the prior record',
      async () => {
        const before = (await getArchive()).people.find((person) => person.id === 'john-lewis')!;
        const receipt = token();
        const author = { ...guest, receiptToken: receipt };
        const { submission } = await createDraft(original(), guest, receipt);
        await finalizeSubmission(submission.id, author);
        await reviewSubmission(submission.id, decision({ applyTo: 'biography' }), reviewer);
        const after = (await getArchive()).people.find((person) => person.id === 'john-lewis')!;
        assert.deepEqual(after.creditIds, before.creditIds);
        assert.equal(after.biography.length, before.biography.length + 1);
        assert.deepEqual(after.biography.at(-1)!.creditIds, [`contributor-${submission.id}`]);
        await reviewSubmission(submission.id, decision({ action: 'withdraw' }), reviewer);
        assert.deepEqual(
          (await getArchive()).people.find((person) => person.id === 'john-lewis'),
          before,
        );
      },
    );
    await t.test(
      'an in-place paragraph edit replaces its paragraph on publication, and a stale edit is refused',
      async () => {
        const before = (await getArchive()).people.find((person) => person.id === 'john-lewis')!;
        const target = before.biography[0]!;
        const anchor = target.id ?? '0';
        const rewritten =
          'A rewritten first paragraph that keeps the facts but reads more clearly for visitors.';
        const receipt = token();
        const author = { ...guest, receiptToken: receipt };
        const { submission } = await createDraft(
          original({
            kind: 'correction',
            body: rewritten,
            placement: { section: 'biography', blockId: anchor, originalText: target.text },
          }),
          guest,
          receipt,
        );
        await finalizeSubmission(submission.id, author);
        await reviewSubmission(submission.id, decision({ applyTo: 'biography' }), reviewer);
        const after = (await getArchive()).people.find((person) => person.id === 'john-lewis')!;
        assert.equal(after.biography.length, before.biography.length);
        assert.equal(after.biography[0]!.text, rewritten);
        assert.equal(after.biography[0]!.id, target.id ?? `contribution-${submission.id}`);
        assert.ok(after.biography[0]!.creditIds.includes(`contributor-${submission.id}`));
        assert.ok(after.biography[0]!.citations.length >= target.citations.length);
        // A second edit written against the old text no longer matches anything.
        const staleReceipt = token();
        const staleAuthor = { ...guest, receiptToken: staleReceipt };
        const stale = await createDraft(
          original({
            kind: 'correction',
            body: 'Another rewrite of the same paragraph that must not land anywhere.',
            placement: { section: 'biography', blockId: anchor, originalText: target.text },
          }),
          guest,
          staleReceipt,
        );
        await finalizeSubmission(stale.submission.id, staleAuthor);
        await assert.rejects(
          reviewSubmission(stale.submission.id, decision({ applyTo: 'biography' }), reviewer),
          { code: 'BAD_REQUEST' },
        );
        assert.equal((await getSubmission(stale.submission.id, staleAuthor)).status, 'pending');
        await reviewSubmission(
          stale.submission.id,
          decision({
            action: 'reject',
            authorMessage: 'The paragraph changed since you wrote this.',
          }),
          reviewer,
        );
        await reviewSubmission(submission.id, decision({ action: 'withdraw' }), reviewer);
        assert.deepEqual(
          (await getArchive()).people.find((person) => person.id === 'john-lewis'),
          before,
        );
      },
    );
    await t.test(
      'an in-page place edit updates the existing relationship instead of adding a second one',
      async () => {
        const before = await getArchive();
        const relation = before.relations.find((item) => item.personId === 'john-lewis')!;
        const place = before.places.find((item) => item.id === relation.placeId)!;
        const receipt = token();
        const author = { ...guest, receiptToken: receipt };
        const { submission } = await createDraft(
          original({
            kind: 'correction',
            placeIds: [place.id],
            body: 'A corrected account of how this place figured in his life, written in place.',
            placement: {
              section: 'places',
              blockId: relation.id,
              originalText: relation.description,
              proposedCoordinates: [-84.37, 33.702],
              proposedScope: 'cemetery',
              proposedPlaceSummary: 'A family plot near the chapel, according to the contributor.',
            },
          }),
          guest,
          receipt,
        );
        await finalizeSubmission(submission.id, author);
        await reviewSubmission(
          submission.id,
          decision({
            applyTo: 'place',
            sourceIds: [before.sources[0]!.id],
            placePatch: {
              placeId: place.id,
              name: place.name,
              scope: 'cemetery',
              coordinates: [-84.37, 33.702],
              precision: 'reference',
              locationNote: 'Moved by a contributor; reference position.',
              relationship: relation.label,
              summary: 'A family plot near the chapel, according to the contributor.',
            },
          }),
          reviewer,
        );
        const after = await getArchive();
        const relationsAfter = after.relations.filter(
          (item) => item.personId === 'john-lewis' && item.placeId === place.id,
        );
        assert.equal(relationsAfter.length, 1);
        assert.equal(relationsAfter[0]!.id, relation.id);
        assert.ok(relationsAfter[0]!.description.startsWith('A corrected account'));
        assert.ok(relationsAfter[0]!.creditIds.includes(`contributor-${submission.id}`));
        assert.deepEqual(
          after.places.find((item) => item.id === place.id)!.coordinates,
          [-84.37, 33.702],
        );
        assert.equal(
          after.places.find((item) => item.id === place.id)!.summary,
          'A family plot near the chapel, according to the contributor.',
        );
        assert.ok(
          after.places
            .find((item) => item.id === place.id)!
            .summaryCitations.some((citation) => citation.sourceId === before.sources[0]!.id),
        );
        await reviewSubmission(submission.id, decision({ action: 'withdraw' }), reviewer);
        const restored = await getArchive();
        assert.deepEqual(
          restored.relations.find((item) => item.id === relation.id),
          relation,
        );
        assert.deepEqual(
          restored.places.find((item) => item.id === place.id),
          place,
        );
      },
    );
    await t.test(
      'new people require explicit review, coordinate errors roll back, and dependent publications prevent unsafe withdrawal',
      async () => {
        const receipt = token();
        const author = { ...guest, receiptToken: receipt };
        const { submission } = await createDraft(
          original({ personId: null, proposedPersonName: 'John Lewis', kind: 'new-person' }),
          guest,
          receipt,
        );
        await finalizeSubmission(submission.id, author);
        await assert.rejects(reviewSubmission(submission.id, decision(), reviewer), {
          code: 'BAD_REQUEST',
        });
        assert.equal((await getSubmission(submission.id, reviewer)).reviews.length, 0);
        await reviewSubmission(
          submission.id,
          decision({ newPersonName: 'A separately identified John Lewis' }),
          reviewer,
        );
        const newEntry = (await getPublicContribution(submission.id))!;
        assert.notEqual(newEntry.personId, 'john-lewis');
        assert.equal((await getArchive()).people.length, 4);
        await reviewSubmission(submission.id, decision({ action: 'withdraw' }), reviewer);
        assert.equal((await getArchive()).people.length, 3);
        const nextReceipt = token();
        const nextAuthor = { ...guest, receiptToken: nextReceipt };
        const next = (await createDraft(original(), guest, nextReceipt)).submission;
        await finalizeSubmission(next.id, nextAuthor);
        await assert.rejects(
          reviewSubmission(
            next.id,
            decision({
              applyTo: 'place',
              placePatch: {
                placeId: 'test-place',
                name: 'Cited community location',
                scope: 'atlanta',
                coordinates: [33.75, -84.38],
                precision: 'address',
                locationNote: 'Supplied location',
                relationship: 'Worked here',
              },
            }),
            reviewer,
          ),
        );
        assert.equal((await getSubmission(next.id, nextAuthor)).status, 'pending');
        await reviewSubmission(
          next.id,
          decision({
            applyTo: 'place',
            placePatch: {
              placeId: 'test-place',
              name: 'Cited community location',
              scope: 'atlanta',
              coordinates: [-84.38, 33.75],
              precision: 'address',
              locationNote: 'Supplied location',
              relationship: 'Worked here',
            },
          }),
          reviewer,
        );
        const published = (await getArchive()).places.find((place) => place.id === 'test-place')!;
        assert.deepEqual(published.creditIds, [`contributor-${next.id}`]);
        await store.query(
          "UPDATE archive.places SET data=jsonb_set(data,'{name}','\"Later curator correction\"'::jsonb) WHERE id='test-place'",
        );
        await assert.rejects(
          reviewSubmission(next.id, decision({ action: 'withdraw' }), reviewer),
          { code: 'CONFLICT' },
        );
        assert.ok(await getPublicContribution(next.id));
        assert.equal((await getSubmission(next.id, nextAuthor)).status, 'published');
      },
    );
    await t.test(
      'an approved portrait photograph becomes the person’s portrait and leaves with withdrawal',
      async () => {
        const before = (await getArchive()).people.find((person) => person.id === 'john-lewis')!;
        const receipt = token();
        const author = { ...guest, receiptToken: receipt };
        const { submission } = await createDraft(
          original({
            placement: { section: 'portrait' },
            body: 'A photograph of him taken outside the church, probably in the early 1960s.',
          }),
          guest,
          receipt,
        );
        const picture = photo({ caption: 'Outside the church, early 1960s' });
        await attachPhoto(submission.id, picture, author);
        await finalizeSubmission(submission.id, author);
        await assert.rejects(
          reviewSubmission(
            submission.id,
            decision({ applyTo: 'portrait', approvedPhotoIds: [] }),
            reviewer,
          ),
          { code: 'BAD_REQUEST' },
        );
        await reviewSubmission(
          submission.id,
          decision({ applyTo: 'portrait', approvedPhotoIds: [picture.id] }),
          reviewer,
        );
        const after = (await getArchive()).people.find((person) => person.id === 'john-lewis')!;
        assert.equal(after.portrait?.url, `/api/community/media/${picture.id}`);
        assert.equal(after.portrait?.alt, 'Outside the church, early 1960s');
        assert.equal(after.portrait?.sourceId, `contribution-${submission.id}`);
        assert.ok(after.creditIds.includes(`contributor-${submission.id}`));
        assert.ok(await getPublicPhoto(picture.id));
        // A staff correction to the photograph's caption and rights reaches the portrait too.
        await editContribution(
          submission.id,
          {
            patch: {
              photos: [
                {
                  id: picture.id,
                  caption: 'Outside Ebenezer, about 1962',
                  creator: picture.creator,
                  rights: 'CC BY 4.0',
                },
              ],
            },
            reason: 'Caption checked with the family',
          },
          reviewer,
        );
        const corrected = (await getArchive()).people.find((p) => p.id === 'john-lewis')!;
        assert.equal(corrected.portrait?.alt, 'Outside Ebenezer, about 1962');
        assert.equal(corrected.portrait?.rights, 'CC BY 4.0');
        // Withdrawal still takes the portrait away with the contribution.
        await reviewSubmission(submission.id, decision({ action: 'withdraw' }), reviewer);
        assert.deepEqual(
          (await getArchive()).people.find((person) => person.id === 'john-lewis'),
          before,
        );
      },
    );
    await t.test(
      'a reviewer can change the person record itself, for existing and new people',
      async () => {
        const before = (await getArchive()).people.find((person) => person.id === 'john-lewis')!;
        const receipt = token();
        const author = { ...guest, receiptToken: receipt };
        const { submission } = await createDraft(original(), guest, receipt);
        await finalizeSubmission(submission.id, author);
        await reviewSubmission(
          submission.id,
          decision({
            personPatch: {
              name: 'John Robert Lewis',
              aliases: ['Representative Lewis'],
              birthYear: 1940,
              deathYear: 2020,
              themes: ['Civil rights', 'Congress'],
              summary: 'A corrected summary written by the reviewer.',
            },
          }),
          reviewer,
        );
        const after = (await getArchive()).people.find((person) => person.id === 'john-lewis')!;
        assert.equal(after.name, 'John Robert Lewis');
        assert.deepEqual(after.aliases, ['Representative Lewis']);
        assert.equal(after.birthYear, 1940);
        assert.equal(after.deathYear, 2020);
        assert.deepEqual(after.themes, ['Civil rights', 'Congress']);
        assert.equal(after.summary, 'A corrected summary written by the reviewer.');
        assert.ok(
          after.summaryCitations.some(
            (citation) => citation.sourceId === `contribution-${submission.id}`,
          ),
        );
        assert.deepEqual(after.biography, before.biography);
        await reviewSubmission(submission.id, decision({ action: 'withdraw' }), reviewer);
        assert.deepEqual(
          (await getArchive()).people.find((person) => person.id === 'john-lewis'),
          before,
        );
        const fresh = token();
        const created = await createDraft(
          original({ kind: 'new-person', personId: null, proposedPersonName: 'Ada Example' }),
          guest,
          fresh,
        );
        await finalizeSubmission(created.submission.id, { ...guest, receiptToken: fresh });
        await reviewSubmission(
          created.submission.id,
          decision({
            personId: null,
            newPersonName: 'Ada Example',
            personPatch: { deathYear: 1952, themes: ['Education'], summary: 'A teacher.' },
          }),
          reviewer,
        );
        const person = (await getArchive()).people.find(
          (item) => item.id === `person-${created.submission.id}`,
        )!;
        assert.equal(person.name, 'Ada Example');
        assert.equal(person.deathYear, 1952);
        assert.deepEqual(person.themes, ['Education']);
        assert.equal(person.summary, 'A teacher.');
      },
    );
    await t.test(
      'fixture mode is read-only even when a writable test connection exists',
      async () => {
        process.env.ARCHIVE_DATA_MODE = 'fixture';
        assert.equal((await getArchive()).contributions.length, 0);
        await assert.rejects(createDraft(original(), guest, token()), { code: 'READ_ONLY' });
        delete process.env.ARCHIVE_DATA_MODE;
      },
    );
  } finally {
    setStoreForTests(undefined);
    await store.close();
    if (previousMode === undefined) delete process.env.ARCHIVE_DATA_MODE;
    else process.env.ARCHIVE_DATA_MODE = previousMode;
  }
});

test('contacts migration upgrades earlier saved submissions without duplicating private fields', async () => {
  const store = await createStore({
    mode: 'local',
    path: 'memory://',
    migrate: false,
    seed: false,
  });
  try {
    for (const filename of ['0001_archive.sql', '0002_community.sql', '0003_auth.sql']) {
      await store.exec(
        await readFile(new URL(`../packages/db/migrations/${filename}`, import.meta.url), 'utf8'),
      );
    }
    const input = original();
    const id = randomUUID();
    await store.query(
      'INSERT INTO community.submissions (id,client_request_id,input,receipt_hash) VALUES ($1,$2,$3::jsonb,$4)',
      [id, input.clientRequestId, JSON.stringify(input), '0'.repeat(64)],
    );
    await store.exec(
      await readFile(
        new URL('../packages/db/migrations/0004_contacts.sql', import.meta.url),
        'utf8',
      ),
    );
    const content = (
      await store.query<{ input: Record<string, unknown> }>(
        'SELECT input FROM community.submissions WHERE id=$1',
        [id],
      )
    ).rows[0]!.input;
    const contact = (
      await store.query<{ private_name: string; email: string }>(
        'SELECT private_name,email FROM community.contacts WHERE submission_id=$1',
        [id],
      )
    ).rows[0]!;
    assert.equal(content.email, undefined);
    assert.equal(content.privateName, undefined);
    assert.equal(content.body, input.body);
    assert.deepEqual(contact, { private_name: input.privateName, email: input.email });
  } finally {
    await store.close();
  }
});

test('durable local store survives restart and initial seed never overwrites later changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'southview-community-test-'));
  const dbPath = join(directory, 'db');
  let store = await createStore({ mode: 'local', path: dbPath });
  const receipt = token();
  try {
    await assert.rejects(createStore({ mode: 'local', path: dbPath }), /open in another process/);
    setStoreForTests(store);
    const { submission } = await createDraft(original(), guest, receipt);
    await store.query(
      "UPDATE archive.persons SET data=jsonb_set(data,'{summary}','\"Preserved curator edit\"'::jsonb) WHERE id='john-lewis'",
    );
    await store.close();
    store = await createStore({ mode: 'local', path: dbPath });
    setStoreForTests(store);
    assert.equal(
      (await getSubmission(submission.id, { ...guest, receiptToken: receipt })).id,
      submission.id,
    );
    assert.equal(
      (await readStoreArchive(store)).people.find((person) => person.id === 'john-lewis')!.summary,
      'Preserved curator edit',
    );
  } finally {
    setStoreForTests(undefined);
    await store.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())));
    await rm(directory, { recursive: true, force: true });
  }
});
