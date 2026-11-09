import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureArchive } from '../packages/db/src/fixtures';
import {
  reviewInputSchema,
  submissionInputSchema,
  type SubmissionRecord,
} from '../packages/validators/src/community';
import {
  adminRecordUrl,
  parseAdminPath,
  filterReviewQueue,
  parseReviewState,
  reviewUrl,
  selectedReview,
  unavailableVet,
} from '../apps/nextjs/src/lib/review-state';

const archive = fixtureArchive;
function submission(id: string, overrides: Partial<SubmissionRecord> = {}): SubmissionRecord {
  return {
    id,
    input: submissionInputSchema.parse({
      clientRequestId: '11111111-1111-4111-8111-111111111111',
      kind: 'memory',
      personId: 'john-lewis',
      title: 'An afternoon remembered',
      body: 'A personal memory without an external link, supplied for archive review.',
      privateName: 'Hidden Name',
      email: 'hidden@example.org',
      anonymous: true,
      displayName: '',
      permission: true,
    }),
    status: 'pending',
    userId: null,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
    photos: [],
    supplements: [],
    reviews: [],
    publishedEntryId: null,
    ...overrides,
  };
}

test('review state restores selection and filters, encodes search, and bounds invalid URL input', () => {
  const state = parseReviewState(
    new URLSearchParams('status=published&kind=memory&q=John+%26+family&submission=abc'),
  );
  assert.deepEqual(
    parseReviewState(new URL(reviewUrl(state), 'https://archive.example').searchParams),
    state,
  );
  assert.deepEqual(parseReviewState(new URLSearchParams('status=unknown&kind=unknown')), {
    status: 'pending',
    kind: 'all',
    q: '',
    submission: null,
  });
  assert.equal(parseReviewState(new URLSearchParams({ q: 'x'.repeat(500) })).q.length, 200);
});

test('queue searches title, record ID and matched people, with combined filters and no private identity search', () => {
  const first = submission('reference-123');
  const second = submission('reference-456', {
    status: 'published',
    input: {
      ...first.input,
      kind: 'correction',
      title: 'A date correction',
      personId: null,
      proposedPersonName: 'New Community Person',
    },
  });
  const items = [first, second, submission('draft', { status: 'draft' })];
  const state = parseReviewState(new URLSearchParams('status=all'));
  for (const q of ['AFTERNOON', 'reference-123', 'john lewis'])
    assert.deepEqual(
      filterReviewQueue(items, { ...state, q }, archive).map((item) => item.id),
      [first.id],
    );
  assert.deepEqual(
    filterReviewQueue(
      items,
      { ...state, q: 'New Community Person', kind: 'correction' },
      archive,
    ).map((item) => item.id),
    [second.id],
  );
  assert.equal(filterReviewQueue(items, { ...state, q: 'hidden@example.org' }, archive).length, 0);
  assert.equal(filterReviewQueue(items, { ...state, q: 'Hidden Name' }, archive).length, 0);
  assert.equal(filterReviewQueue(items, state, archive).length, 2);
});

test('a published or rejected selection stays open outside the pending filter; stale IDs do not select a different record', () => {
  const published = submission('selected', { status: 'published' });
  const pending = submission('next');
  assert.equal(selectedReview([published, pending], [pending], published.id)?.id, published.id);
  assert.equal(selectedReview([pending], [pending], 'missing'), undefined);
  assert.equal(selectedReview([pending], [pending], null)?.id, pending.id);
});

test('unconfigured Vet does not prevent human publication; decisions require contributor messages', () => {
  assert.deepEqual(unavailableVet, { status: 'not-configured' });
  assert.equal(reviewInputSchema.safeParse({ action: 'publish' }).success, true);
  for (const action of ['reject', 'needs-information']) {
    for (const authorMessage of [undefined, '', '   '])
      assert.equal(reviewInputSchema.safeParse({ action, authorMessage }).success, false);
    assert.equal(
      reviewInputSchema.safeParse({
        action,
        authorMessage: 'Please clarify the date of this memory.',
      }).success,
      true,
    );
  }
});

test('review validation names the field that is missing instead of a raw length rule', () => {
  const place = {
    placeId: 'community-place-1',
    name: 'Burial site',
    scope: 'cemetery',
    coordinates: null,
    precision: 'unmapped',
    locationNote: 'No position has been verified.',
    relationship: '',
  };
  const relationship = reviewInputSchema.safeParse({ action: 'publish', placePatch: place });
  assert.equal(relationship.success, false);
  assert.equal(
    relationship.error?.issues[0]?.message,
    'Describe the person’s relationship to the map place.',
  );
  const note = reviewInputSchema.safeParse({
    action: 'publish',
    placePatch: { ...place, relationship: 'Buried here', locationNote: '  ' },
  });
  assert.equal(
    note.error?.issues[0]?.message,
    'Describe the location evidence and its limits for the map place.',
  );
  const caption = reviewInputSchema.safeParse({
    action: 'publish',
    photoEdits: [{ id: 'p1', caption: '', creator: 'Anon', rights: 'Family photo' }],
  });
  assert.equal(caption.error?.issues[0]?.message, 'Give each approved photograph a caption.');
  const summary = reviewInputSchema.safeParse({ action: 'publish', personPatch: { summary: '' } });
  assert.equal(
    summary.error?.issues[0]?.message,
    'Enter a summary for the person, or leave it as it was.',
  );
  for (const message of [relationship, note, caption, summary].map(
    (r) => r.error?.issues[0]?.message,
  ))
    assert.equal(message?.includes('Too small'), false);
});

test('each admin area has its own address', () => {
  assert.equal(adminRecordUrl('people', null), '/admin/people');
  assert.equal(adminRecordUrl('places', 'king-sr-south-view'), '/admin/places/king-sr-south-view');
  assert.deepEqual(parseAdminPath('/admin/people/john-lewis'), {
    tab: 'people',
    recordId: 'john-lewis',
  });
  assert.deepEqual(parseAdminPath('/admin/places'), { tab: 'places', recordId: null });
  assert.deepEqual(parseAdminPath('/admin/contributions'), {
    tab: 'contributions',
    recordId: null,
  });
});
