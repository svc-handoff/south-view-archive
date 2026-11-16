import assert from 'node:assert/strict';
import test from 'node:test';
import { mapFieldIssues } from '../apps/nextjs/src/lib/field-validation';
import { submissionInputSchema } from '../packages/validators/src/community';

test('field errors use the closest rendered field and preserve original photo identity', () => {
  assert.deepEqual(
    mapFieldIssues(
      [
        { path: ['placePatch', 'coordinates', 1], message: 'Invalid latitude' },
        { path: ['photoEdits', 0, 'caption'], message: 'Caption required' },
        { path: ['eventDate', 'from'], message: 'Check date' },
      ],
      ['placePatch.coordinates.1', 'photoEdits.second.caption', 'eventDate'],
      ['second'],
    ),
    {
      'placePatch.coordinates.1': 'Invalid latitude',
      'photoEdits.second.caption': 'Caption required',
      eventDate: 'Check date',
    },
  );
});

test('phone is optional, trimmed, and length limited', () => {
  const input = {
    clientRequestId: '4fc09da5-b317-4e49-8c5a-f374e60d7507',
    kind: 'memory',
    personId: 'john-lewis',
    title: 'A memory',
    body: 'A sufficiently long personal memory.',
    privateName: 'Test Name',
    email: 'test@example.org',
    anonymous: true,
    permission: true,
  };
  assert.equal(submissionInputSchema.parse(input).phone, undefined);
  assert.equal(
    submissionInputSchema.parse({ ...input, phone: ' +1 (404) 555-0123 ' }).phone,
    '+1 (404) 555-0123',
  );
  assert.equal(submissionInputSchema.safeParse({ ...input, phone: '1'.repeat(51) }).success, false);
});

test('unmapped validation issues remain visible as form feedback', () => {
  assert.deepEqual(
    mapFieldIssues([{ path: ['unexpectedField'], message: 'Please check this value.' }], ['title']),
    { form: 'Please check this value.' },
  );
});
