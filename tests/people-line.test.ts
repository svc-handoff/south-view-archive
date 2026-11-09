import assert from 'node:assert/strict';
import test from 'node:test';
import { peopleLine } from '../apps/nextjs/src/lib/people-line';

test('a place hover card names up to three connected people, then counts the rest', () => {
  assert.equal(peopleLine([]), '');
  assert.equal(peopleLine(['Alonzo Herndon']), 'Alonzo Herndon');
  assert.equal(
    peopleLine(['Martin Luther King Sr.', 'Alberta Williams King']),
    'Martin Luther King Sr., Alberta Williams King',
  );
  assert.equal(peopleLine(['A', 'B', 'C']), 'A, B, C');
  assert.equal(peopleLine(['A', 'B', 'C', 'D']), 'A, B, C +1 more');
  assert.equal(peopleLine(['A', 'B', 'C', 'D', 'E']), 'A, B, C +2 more');
});

test('a person with two connections to the same place is named once', () => {
  assert.equal(peopleLine(['A', 'A', 'B', ' ']), 'A, B');
});
