import assert from 'node:assert/strict';
import test from 'node:test';
import { cemeteryArea, cemeteryBounds, mapPadding } from '../apps/nextjs/src/lib/cemetery-area';

test('the attributed cemetery outline is a closed Atlanta polygon in longitude/latitude order', () => {
  const ring = cemeteryArea.geometry.coordinates[0]!;
  assert.deepEqual(ring[0], ring.at(-1));
  assert.ok(ring.length > 4);
  assert.match(cemeteryArea.properties.sourceUrl, /fultoncountyga\.gov\/.*Tax_Parcels/);
  for (const [lng, lat] of ring) {
    assert.ok(lng! > -84.38 && lng! < -84.36, 'longitude must remain in South-View');
    assert.ok(lat! > 33.69 && lat! < 33.71, 'latitude must remain in South-View');
    assert.ok(lng! >= cemeteryBounds[0][0] && lng! <= cemeteryBounds[1][0]);
    assert.ok(lat! >= cemeteryBounds[0][1] && lat! <= cemeteryBounds[1][1]);
  }
});

test('floating panels leave a usable camera area on phones, desktops and short viewports', () => {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [632, 356],
    [800, 600],
    [1365, 900],
  ]) {
    for (const details of [false, true])
      for (const results of [false, true]) {
        const padding = mapPadding(width!, height!, details, results);
        assert.ok(width! - padding.left - padding.right >= 150);
        assert.ok(height! - padding.top - padding.bottom >= 60);
      }
  }
});
