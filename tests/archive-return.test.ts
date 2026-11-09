import assert from 'node:assert/strict';
import test from 'node:test';
import { safeArchiveReturn, withArchiveReturn } from '../apps/nextjs/src/lib/archive-return';

test('return targets stay inside the map and never carry receipts or foreign origins', () => {
  assert.equal(
    safeArchiveReturn('/explore?person=john-lewis&z=17'),
    '/explore?person=john-lewis&z=17',
  );
  assert.equal(safeArchiveReturn('/explore?q=family#receipt=private'), '/explore?q=family');
  for (const value of [
    undefined,
    '',
    'https://evil.example/explore',
    '//evil.example',
    '/stories?q=family',
    '/explore/../sign-in',
    '/sign-in?next=/explore',
    `/explore?q=${'x'.repeat(3000)}`,
  ])
    assert.equal(safeArchiveReturn(value), '/explore', String(value));
});

test('record links keep their anchors while adding a safe return target', () => {
  assert.equal(
    withArchiveReturn(
      '/people/alonzo-herndon?from=old#source-herndon-home',
      '/explore?scope=atlanta',
    ),
    '/people/alonzo-herndon?from=%2Fexplore%3Fscope%3Datlanta#source-herndon-home',
  );
  assert.equal(
    withArchiveReturn('/contributions/abc', '/stories?q=x'),
    '/contributions/abc?from=%2Fexplore',
  );
});
