import assert from 'node:assert/strict';
import test from 'node:test';
import { placeParagraph } from '../packages/db/src/community';

const cite = (sourceId: string) => ({ sourceId });
const biography = [
  {
    id: 'birth',
    text: 'Born in 1898 in Atlanta.',
    citations: [cite('s1')],
    creditIds: ['initial'],
  },
  { text: 'Taught school for thirty years.', citations: [cite('s2')], creditIds: ['initial'] },
  { id: 'death', text: 'Buried at South-View.', citations: [cite('s3')], creditIds: ['initial'] },
];
const incoming = {
  id: 'contribution-x',
  text: 'Born in 1899 in Atlanta, according to the family Bible.',
  citations: [cite('s9')],
  creditIds: ['credit-x'],
};

test('an addition follows the paragraph it was written under', () => {
  const placed = placeParagraph(biography, incoming, { kind: 'addition', anchor: 'birth' });
  assert.deepEqual(
    placed?.map((p) => p.id ?? p.text),
    ['birth', 'contribution-x', 'Taught school for thirty years.', 'death'],
  );
  // Paragraphs from the initial compilation are anchored by their index.
  const afterSecond = placeParagraph(biography, incoming, { kind: 'addition', anchor: '1' });
  assert.equal(afterSecond?.[2]?.id, 'contribution-x');
  // No anchor, or an anchor that no longer exists, appends.
  assert.equal(
    placeParagraph(biography, incoming, { kind: 'addition' })?.at(-1)?.id,
    'contribution-x',
  );
  assert.equal(
    placeParagraph(biography, incoming, { kind: 'addition', anchor: 'gone' })?.at(-1)?.id,
    'contribution-x',
  );
});

test('a correction replaces its paragraph, keeping the id and merging evidence', () => {
  const placed = placeParagraph(biography, incoming, {
    kind: 'correction',
    anchor: 'birth',
    originalText: 'Born in 1898 in Atlanta.',
  });
  assert.equal(placed?.length, 3);
  assert.deepEqual(placed?.[0], {
    id: 'birth',
    text: incoming.text,
    citations: [cite('s1'), cite('s9')],
    creditIds: ['initial', 'credit-x'],
  });
  // When the anchor moved but the text is still there, the text wins.
  const byText = placeParagraph(biography, incoming, {
    kind: 'correction',
    anchor: 'death',
    originalText: 'Taught school for thirty years.',
  });
  assert.equal(byText?.[1]?.text, incoming.text);
  assert.equal(byText?.[1]?.id, 'contribution-x');
});

test('a correction whose paragraph has changed is refused rather than misplaced', () => {
  assert.equal(
    placeParagraph(biography, incoming, {
      kind: 'correction',
      anchor: 'birth',
      originalText: 'Some text that was edited away since.',
    }),
    null,
  );
  assert.equal(placeParagraph(biography, incoming, { kind: 'correction', anchor: 'gone' }), null);
});

test('republishing the same contribution does not duplicate its paragraph', () => {
  const once = placeParagraph(biography, incoming, { kind: 'addition', anchor: 'birth' })!;
  const twice = placeParagraph(
    once,
    { ...incoming, text: 'Revised.' },
    { kind: 'addition', anchor: 'birth' },
  )!;
  assert.equal(twice.filter((p) => p.id === 'contribution-x').length, 1);
  assert.equal(twice[1]?.text, 'Revised.');
});
