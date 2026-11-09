import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { processPhoto } from '../src/photos';
import { getStorage, type ImageContentType, type PrivateStorage } from '../src/storage';

// Same precedence as the migration/reviewer commands; this command never opens the database.
// `--env <file>` loads one more file first, for credentials kept outside the repository.
const flag = process.argv.indexOf('--env');
if (flag > 0 && process.argv[flag + 1])
  loadEnvFile(resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[flag + 1]!));
for (const name of ['.env.local', '.env']) {
  const filename = fileURLToPath(new URL(`../../../${name}`, import.meta.url));
  if (existsSync(filename)) loadEnvFile(filename);
}

const driver = process.env.PHOTO_STORAGE ?? '';
let storage: (PrivateStorage & { close?: () => void }) | undefined;
const written: string[] = [];
const step = (text: string) => process.stdout.write(`  ✓ ${text}\n`);
try {
  if (!['s3', 'vercel-blob', 'supabase'].includes(driver))
    throw new Error('Set PHOTO_STORAGE to s3, vercel-blob or supabase, with its credentials.');
  storage = getStorage(process.env);
  process.stdout.write(`Checking ${driver} photo storage…\n`);
  const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#70513f' } })
    .png()
    .toBuffer();
  const photo = await processPhoto(input);
  const id = randomUUID();
  const objects: { key: string; bytes: Buffer; contentType: ImageContentType }[] = [
    { key: `originals/${id}.png`, bytes: photo.original, contentType: 'image/png' },
    { key: `processed/${id}.jpg`, bytes: photo.processed, contentType: 'image/jpeg' },
  ];
  for (const object of objects) {
    await storage.write(object.key, object.bytes, object.contentType);
    written.push(object.key);
    const read = await storage.read(object.key);
    if (!read?.bytes.equals(object.bytes) || read.contentType !== object.contentType)
      throw new Error('Read-back verification failed.');
  }
  step('write and read back');
  try {
    await storage.write(objects[0]!.key, objects[0]!.bytes, objects[0]!.contentType);
    throw new Error('An existing photo was overwritten.');
  } catch (error) {
    if (error instanceof Error && error.message === 'An existing photo was overwritten.')
      throw error;
  }
  step('existing photos are never overwritten');

  if (storage.signDownload) {
    const url = await storage.signDownload(objects[0]!.key);
    const signed = await fetch(url, { cache: 'no-store' });
    if (!signed.ok || !Buffer.from(await signed.arrayBuffer()).equals(objects[0]!.bytes))
      throw new Error('Signed download failed.');
    const bare = new URL(url);
    bare.search = '';
    const open = await fetch(bare, { cache: 'no-store' });
    if (open.ok) throw new Error('A private photo could be read without a signed link.');
    step(`signed download works; the unsigned address is refused (${open.status})`);
  }
  if (storage.signUpload) {
    const key = `staging/${randomUUID()}.jpg`;
    const { url, headers } = await storage.signUpload(
      key,
      photo.processed.byteLength,
      'image/jpeg',
    );
    const put = await fetch(url, {
      method: 'PUT',
      headers,
      body: new Uint8Array(photo.processed),
    });
    if (!put.ok) throw new Error(`Signed upload failed with ${put.status}.`);
    written.push(key);
    const read = await storage.read(key);
    if (!read?.bytes.equals(photo.processed)) throw new Error('Signed upload read-back failed.');
    const again = await fetch(url, {
      method: 'PUT',
      headers,
      body: new Uint8Array(photo.processed),
    });
    if (again.ok) throw new Error('A signed upload overwrote an existing photo.');
    step('signed direct upload works and cannot overwrite');
  }
  for (const key of written) {
    await storage.delete(key);
    if (await storage.read(key)) throw new Error('Deletion verification failed.');
  }
  written.length = 0;
  step('delete');
  process.stdout.write('Photo storage check passed.\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Storage check failed.'}\n`);
  process.exitCode = 1;
} finally {
  for (const key of written) {
    try {
      await storage?.delete(key);
    } catch {
      process.stderr.write(
        `Could not remove probe object ${key}; remove it in the provider console.\n`,
      );
      process.exitCode = 1;
    }
  }
  storage?.close?.();
}
