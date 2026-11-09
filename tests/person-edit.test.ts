import assert from 'node:assert/strict';
import test from 'node:test';
import { submissionInputSchema } from '@southview/validators';
import {
  blockToSubmissionInput,
  defaultBlockTitle,
  groupedReceiptUrl,
  restoreEditSession,
  serializeEditSession,
  validateBlock,
  type EditBlock,
} from '../apps/nextjs/src/lib/person-edit';

const person = { id: 'john-lewis', name: 'John Lewis' };
const contact = {
  privateName: 'Private Tester',
  email: 'Tester@Example.org',
  anonymous: false,
  displayName: 'The Hill family',
};
function block(overrides: Partial<EditBlock> = {}): EditBlock {
  return {
    id: '0f6d3c5e-3f0e-4b8c-9b0a-2f5a4f1c9d11',
    section: 'biography',
    kind: 'addition',
    anchor: 'nashville',
    title: '',
    body: 'He kept the same pew at Ebenezer for decades, according to our family.',
    context: 'My grandmother sat behind him.',
    placeIds: [],
    proposedPlaceName: '',
    photos: [],
    ...overrides,
  };
}

test('an in-page block becomes an ordinary submission with an advisory placement', () => {
  const input = submissionInputSchema.parse(blockToSubmissionInput(block(), person, contact));
  assert.equal(input.kind, 'addition');
  assert.equal(input.personId, 'john-lewis');
  assert.equal(input.title, "An addition to John Lewis's story");
  assert.deepEqual(input.placement, { section: 'biography', blockId: 'nashville' });
  assert.equal(input.email, 'tester@example.org');
  assert.equal(input.displayName, 'The Hill family');
  assert.deepEqual(input.links, []);
  const place = submissionInputSchema.parse(
    blockToSubmissionInput(
      block({
        section: 'places',
        anchor: undefined,
        title: 'Wheat Street',
        proposedPlaceName: 'Wheat Street Baptist Church',
        context: '',
      }),
      person,
      { ...contact, anonymous: true },
    ),
  );
  assert.deepEqual(place.placement, {
    section: 'places',
    proposedPlaceName: 'Wheat Street Baptist Church',
  });
  assert.equal(place.displayName, '');
  assert.equal(place.anonymous, true);
  assert.equal(
    defaultBlockTitle({ section: 'biography', kind: 'correction' }, 'Ada'),
    "Correction to Ada's story",
  );
});

test('local validation mirrors the server rules for each section', () => {
  assert.deepEqual(validateBlock(block()), []);
  assert.equal(validateBlock(block({ body: 'too short' }))[0]?.field, 'body');
  assert.equal(validateBlock(block({ title: 'ab' }))[0]?.field, 'title');
  assert.equal(validateBlock(block({ section: 'places', anchor: undefined }))[0]?.field, 'place');
  assert.equal(
    validateBlock(block({ section: 'portrait', anchor: undefined }))[0]?.field,
    'photos',
  );
  const incompletePhoto = block({
    section: 'community',
    kind: 'memory',
    anchor: undefined,
    photos: [
      {
        clientPhotoId: 'p1',
        file: null,
        name: 'a.jpg',
        preview: 'blob:x',
        metadata: { caption: 'A caption', creator: '', rights: 'Family', permission: true },
      },
    ],
  });
  assert.equal(validateBlock(incompletePhoto)[0]?.field, 'photos');
});

test('session text survives a reload without files, and hostile values are dropped', () => {
  const token = 'r'.repeat(72);
  const saved = JSON.parse(
    serializeEditSession({
      receiptToken: token,
      blocks: [
        block({
          photos: [
            {
              clientPhotoId: 'p1',
              file: null,
              name: 'a.jpg',
              preview: 'blob:x',
              metadata: { caption: 'c', creator: 'c', rights: 'r', permission: true },
            },
          ],
        }),
      ],
    }),
  );
  assert.equal(JSON.stringify(saved).includes('blob:'), false);
  const restored = restoreEditSession(saved);
  assert.ok(restored);
  assert.equal(restored.receiptToken, token);
  assert.equal(restored.blocks[0]?.hadPhotos, true);
  assert.deepEqual(restored.blocks[0]?.photos, []);
  assert.equal(restored.blocks[0]?.body, block().body);
  assert.equal(restoreEditSession({ receiptToken: 'short', blocks: [] }), null);
  assert.deepEqual(
    restoreEditSession({
      receiptToken: token,
      blocks: [{ id: 'x', section: 'secret', kind: 'addition' }, 'junk', null],
    })?.blocks,
    [],
  );
});

test('grouped receipts share one private token in the fragment', () => {
  assert.equal(groupedReceiptUrl(['a'], 'tok'), '/submissions/a#receipt=tok');
  assert.equal(groupedReceiptUrl(['a', 'b', 'c'], 'tok'), '/submissions/a#receipt=tok&also=b%2Cc');
});

test('an in-place paragraph edit carries the original text and refuses unchanged text', () => {
  const original = 'He kept the same pew at Ebenezer for decades, according to our family.';
  const edit = block({ kind: 'correction', originalText: original, body: original });
  assert.equal(validateBlock(edit)[0]?.message, 'Change the paragraph, or cancel.');
  const changed = {
    ...edit,
    body: 'He kept the same pew at Ebenezer for forty years, our family says.',
  };
  assert.deepEqual(validateBlock(changed), []);
  const input = submissionInputSchema.parse(blockToSubmissionInput(changed, person, contact));
  assert.equal(input.kind, 'correction');
  assert.equal(input.title, "Correction to John Lewis's story");
  assert.deepEqual(input.placement, {
    section: 'biography',
    blockId: 'nashville',
    originalText: original,
  });
});

test('a place marked on the map travels as a proposed position, unless an existing place was chosen', () => {
  const marked = block({
    section: 'places',
    anchor: undefined,
    proposedPlaceName: 'Wheat Street Baptist Church',
    coordinates: [-84.38, 33.755],
    scope: 'atlanta',
  });
  const input = submissionInputSchema.parse(blockToSubmissionInput(marked, person, contact));
  assert.deepEqual(input.placement, {
    section: 'places',
    proposedPlaceName: 'Wheat Street Baptist Church',
    proposedCoordinates: [-84.38, 33.755],
    proposedScope: 'atlanta',
  });
  const existing = submissionInputSchema.parse(
    blockToSubmissionInput(
      block({
        section: 'places',
        anchor: undefined,
        placeIds: ['south-view'],
        coordinates: [1, 2],
      }),
      person,
      contact,
    ),
  );
  assert.deepEqual(existing.placement, { section: 'places' });
  const restored = restoreEditSession(
    JSON.parse(serializeEditSession({ receiptToken: 'r'.repeat(72), blocks: [marked] })),
  );
  assert.deepEqual(restored?.blocks[0]?.coordinates, [-84.38, 33.755]);
  assert.equal(restored?.blocks[0]?.scope, 'atlanta');
  const hostile = restoreEditSession({
    receiptToken: 'r'.repeat(72),
    blocks: [{ ...marked, coordinates: ['x', 2], scope: 'moon', photos: [] }],
  });
  assert.equal(hostile?.blocks[0]?.coordinates, null);
  assert.equal(hostile?.blocks[0]?.scope, undefined);
});

test('editing an existing place sends only what changed, and refuses a no-op', () => {
  const existing = block({
    section: 'places',
    kind: 'correction',
    anchor: 'relation-1',
    originalText: 'He preached here every Sunday for twenty years.',
    originalName: 'Wheat Street Baptist Church',
    originalCoordinates: [-84.38, 33.755],
    body: 'He preached here every Sunday for twenty years.',
    placeIds: ['wheat-street'],
    proposedPlaceName: 'Wheat Street Baptist Church',
    coordinates: [-84.38, 33.755],
    scope: 'atlanta',
  });
  assert.equal(validateBlock(existing)[0]?.field, 'place');
  const moved = { ...existing, coordinates: [-84.381, 33.7552] as [number, number] };
  assert.deepEqual(validateBlock(moved), []);
  const input = submissionInputSchema.parse(blockToSubmissionInput(moved, person, contact));
  assert.equal(input.kind, 'correction');
  assert.deepEqual(input.placeIds, ['wheat-street']);
  assert.equal(input.title, "Correction to a place in John Lewis's life");
  assert.deepEqual(input.placement, {
    section: 'places',
    blockId: 'relation-1',
    originalText: 'He preached here every Sunday for twenty years.',
    proposedCoordinates: [-84.381, 33.7552],
    proposedScope: 'atlanta',
  });
  const described = { ...existing, placeSummary: 'A Baptist congregation on Auburn Avenue since 1869.' };
  assert.deepEqual(validateBlock(described), []);
  assert.equal(
    blockToSubmissionInput(described, person, contact).placement?.proposedPlaceSummary,
    'A Baptist congregation on Auburn Avenue since 1869.',
  );
  const renamed = { ...existing, proposedPlaceName: 'Wheat Street Baptist Church (historic)' };
  const renamedInput = blockToSubmissionInput(renamed, person, contact);
  assert.equal(renamedInput.placement?.proposedPlaceName, 'Wheat Street Baptist Church (historic)');
  assert.equal(renamedInput.placement?.proposedCoordinates, undefined);
  const restored = restoreEditSession(
    JSON.parse(serializeEditSession({ receiptToken: 'r'.repeat(72), blocks: [moved] })),
  );
  assert.deepEqual(restored?.blocks[0]?.originalCoordinates, [-84.38, 33.755]);
  assert.equal(restored?.blocks[0]?.originalName, 'Wheat Street Baptist Church');
});
