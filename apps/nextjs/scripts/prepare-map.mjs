import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// MapLibre 6 ships an ESM worker with a relative shared module. Keep both
// together, at the installed version, independent of the application bundler.
const dist = dirname(fileURLToPath(import.meta.resolve('maplibre-gl')));
const destination = fileURLToPath(new URL('../public/vendor/maplibre/', import.meta.url));
await mkdir(destination, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  await copyFile(join(dist, file), join(destination, file));
}
await copyFile(join(dist, '../LICENSE.txt'), join(destination, 'LICENSE.txt'));
