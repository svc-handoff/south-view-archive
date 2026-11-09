import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewInputSchema } from '../packages/validators/src/community';
import { formatReviewIssues } from '../apps/nextjs/src/lib/review-validation';

test('publication errors identify each missing place field', () => {
  const result = reviewInputSchema.safeParse({
    action: 'publish',
    applyTo: 'place',
    placePatch: {
      placeId: 'new-place',
      name: '',
      scope: 'cemetery',
      coordinates: null,
      precision: 'unmapped',
      locationNote: '',
      relationship: '',
    },
  });
  assert.equal(result.success, false);
  if (result.success) return;
  const message = formatReviewIssues(result.error.issues);
  assert.match(message, /Place name:/);
  assert.match(message, /Location evidence and limits:/);
  assert.match(message, /Person’s relationship to this place:/);
});

test('publication errors distinguish fields on different photographs', () => {
  const result = reviewInputSchema.safeParse({
    action: 'publish',
    photoEdits: [
      { id: 'first', caption: '', creator: 'Photographer', rights: 'Permission granted' },
      { id: 'second', caption: 'Portrait', creator: '', rights: '' },
    ],
  });
  assert.equal(result.success, false);
  if (result.success) return;
  const message = formatReviewIssues(result.error.issues);
  assert.match(message, /Photograph 1 — Public caption:/);
  assert.match(message, /Photograph 2 — Creator:/);
  assert.match(message, /Photograph 2 — Rights and use conditions:/);
});

test('publication errors keep the validation reason and identify person fields', () => {
  const result = reviewInputSchema.safeParse({ action: 'publish', personPatch: { summary: '' } });
  assert.equal(result.success, false);
  if (result.success) return;
  const message = formatReviewIssues(result.error.issues);
  assert.match(message, /Person summary:/);
  assert.ok(message.includes(result.error.issues[0]!.message));
});

test('photograph errors keep the displayed number when an earlier photo is excluded', () => {
  const result = reviewInputSchema.safeParse({
    action: 'publish',
    photoEdits: [
      { id: 'second', caption: '', creator: 'Photographer', rights: 'Permission granted' },
    ],
  });
  assert.equal(result.success, false);
  if (result.success) return;
  const message = formatReviewIssues(result.error.issues, [2]);
  assert.match(message, /Photograph 2 — Public caption:/);
  assert.doesNotMatch(message, /Photograph 1/);
});
