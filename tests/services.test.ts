import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve, sep } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createStore, projectRoot, setStoreForTests } from '@southview/db/connection';
import { createAuth, getSession, isReviewer } from '@southview/services/auth';
import { authBaseURL, authSecret } from '@southview/services/config';
import { InvalidPhotoError, processPhoto, savePhoto } from '@southview/services/photos';
import {
  createLocalStorage,
  createSupabaseStorage,
  MAX_PHOTO_BYTES,
} from '@southview/services/storage';
import { googleTestClient, mockGoogle } from './helpers/google';

const requireService = createRequire(new URL('../packages/services/package.json', import.meta.url));
const sharp = requireService('sharp');
const testRoot = resolve(projectRoot(), '.southview', 'tests');
async function temporaryDirectory(t: TestContext) {
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, 'services-'));
  t.after(async () => {
    assert.ok(resolve(directory).startsWith(testRoot + sep));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('local auth secret persists; production requires an explicit secret and HTTPS origin', async (t) => {
  const directory = await temporaryDirectory(t);
  const environment = { NODE_ENV: 'test', SOUTHVIEW_DATA_DIR: directory };
  const first = await authSecret(environment);
  assert.equal(await authSecret(environment), first);
  assert.ok(first.length >= 32);
  await assert.rejects(
    authSecret({ NODE_ENV: 'production', SOUTHVIEW_DATA_DIR: directory }),
    /required/,
  );
  assert.throws(
    () => authBaseURL({ NODE_ENV: 'production', BETTER_AUTH_URL: 'http://example.org' }),
    /HTTPS/,
  );
});

test('photos are decoded, oriented, resized, and stripped of metadata', async () => {
  const original = await sharp({
    create: { width: 40, height: 20, channels: 3, background: '#70513f' },
  })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
  const output = await processPhoto(original);
  const metadata = await sharp(output.processed).metadata();
  assert.equal(metadata.format, 'jpeg');
  assert.equal(output.width, 20);
  assert.equal(output.height, 40);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.xmp, undefined);
  assert.equal(metadata.orientation, undefined);
  assert.deepEqual(output.original, original);
  assert.equal(output.sha256.length, 64);
  for (const format of ['png', 'webp'] as const) {
    const input = await sharp({
      create: { width: 12, height: 8, channels: 4, background: '#ff000080' },
    })
      [format]()
      .toBuffer();
    assert.equal((await processPhoto(input)).originalContentType, `image/${format}`);
  }
  await assert.rejects(
    processPhoto(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')),
    InvalidPhotoError,
  );
  await assert.rejects(processPhoto(Buffer.from([0xff, 0xd8, 0xff, 0x00])), InvalidPhotoError);
  await assert.rejects(processPhoto(Buffer.alloc(MAX_PHOTO_BYTES + 1)), /10 MB/);
});

test('private photo storage uses opaque keys, rejects traversal, and cleans partial writes', async (t) => {
  const directory = await temporaryDirectory(t);
  const storage = createLocalStorage(directory);
  const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
  const saved = await savePhoto(input, storage);
  assert.match(saved.originalKey, /^originals\/[\da-f-]{36}\.png$/);
  assert.match(saved.processedKey, /^processed\/[\da-f-]{36}\.jpg$/);
  assert.deepEqual((await storage.read(saved.originalKey))!.bytes, input);
  assert.equal((await storage.read(saved.processedKey))!.contentType, 'image/jpeg');
  await assert.rejects(storage.read('../auth-secret'), /Invalid/);
  await assert.rejects(storage.write(saved.processedKey, input, 'image/png'), /type/);
  const calls: string[] = [];
  await assert.rejects(
    savePhoto(input, {
      async write(key) {
        calls.push(`write:${key}`);
        if (key.startsWith('processed/')) throw new Error('simulated failure');
      },
      async read() {
        return null;
      },
      async delete(key) {
        calls.push(`delete:${key}`);
      },
    }),
    /simulated/,
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[2], calls[0]!.replace('write:', 'delete:'));
  await storage.delete(saved.originalKey);
  assert.equal(await storage.read(saved.originalKey), null);
});

test('Supabase refuses a public bucket before any upload and authenticates private reads', async () => {
  const environment = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_PRIVATE_BUCKET: 'private-photos',
    SUPABASE_SERVICE_ROLE_KEY: 'test-secret',
  };
  const key = `processed/${randomUUID()}.jpg`;
  const attempted: string[] = [];
  const publicBucket = createSupabaseStorage(environment, async (input) => {
    attempted.push(String(input));
    return Response.json({ public: true });
  });
  await assert.rejects(publicBucket.write(key, Buffer.from([1]), 'image/jpeg'), /private bucket/);
  assert.equal(attempted.length, 1);
  const privateBucket = createSupabaseStorage(environment, async (input, init) => {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-secret');
    assert.equal(init?.redirect, 'error');
    if (String(input).includes('/bucket/')) return Response.json({ public: false });
    assert.equal(String(input), `https://test.supabase.co/storage/v1/object/private-photos/${key}`);
    return new Response(new Uint8Array([1, 2, 3]));
  });
  assert.deepEqual((await privateBucket.read(key))!.bytes, Buffer.from([1, 2, 3]));
});

test('a Google session is durable, never grants staff by itself, and ends on sign-out', async (t) => {
  const store = await createStore({ mode: 'local', path: 'memory://', seed: false });
  setStoreForTests(store);
  t.after(async () => {
    setStoreForTests(undefined);
    await store.close();
  });
  const origin = 'http://localhost:3000';
  const environment = {
    NODE_ENV: 'test',
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: 'test-secret-at-least-thirty-two-bytes-long',
    GOOGLE_CLIENT_ID: googleTestClient.id,
    GOOGLE_CLIENT_SECRET: googleTestClient.secret,
  };
  const auth = await createAuth(store, environment);
  const google = mockGoogle(t, origin);
  const { cookie, userId } = await google.signIn(auth, {
    sub: 'session-user',
    email: 'visitor@example.org',
    email_verified: true,
  });
  assert.match(cookie, /southview\.session_token=/);
  const reopened = await createAuth(store, environment);
  const session = await reopened.api.getSession({ headers: new Headers({ cookie }) });
  assert.equal(session?.user.email, 'visitor@example.org');
  assert.equal(await isReviewer(userId), false);
  await store.query('INSERT INTO community.reviewers (user_id, granted_by) VALUES ($1, $2)', [
    userId,
    'test-operator',
  ]);
  assert.equal(await isReviewer(userId), true);
  assert.equal(await getSession(new Headers()), null);
  await auth.handler(
    new Request(`${origin}/api/auth/sign-out`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin, cookie },
      body: '{}',
    }),
  );
  assert.equal(await reopened.api.getSession({ headers: new Headers({ cookie }) }), null);
});
