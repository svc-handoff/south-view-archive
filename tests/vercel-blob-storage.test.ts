import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BlobNotFoundError,
  createVercelBlobStorage,
  vercelBlobConfiguration,
  type VercelBlobClient,
} from '../packages/services/src/storage-vercel';
import { getStorage } from '../packages/services/src/storage';

const key = 'staging/0f8fad5b-d9cb-469f-a165-70867728950e.jpg';
const original = 'originals/0f8fad5b-d9cb-469f-a165-70867728950e.jpg';
const environment = { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_store123_secret' };

function fakeClient() {
  const objects = new Map<string, Buffer>();
  const uploadedAt = new Map<string, Date>();
  const calls: { name: string; args: unknown[] }[] = [];
  const delegation = `${Buffer.from(JSON.stringify({ storeId: 'store_store123' })).toString('base64url')}.sig`;
  const client = {
    async put(pathname: string, body: Buffer, options: Record<string, unknown>) {
      calls.push({ name: 'put', args: [pathname, options] });
      if (objects.has(pathname)) throw new Error('exists');
      objects.set(pathname, Buffer.from(body));
      return { url: `https://store123.private.blob.vercel-storage.com/${pathname}` };
    },
    async get(pathname: string, options: Record<string, unknown>) {
      calls.push({ name: 'get', args: [pathname, options] });
      const bytes = objects.get(pathname);
      if (!bytes) return null;
      return {
        statusCode: 200,
        stream: new Blob([bytes]).stream(),
        headers: new Headers(),
        blob: { size: bytes.byteLength, contentType: 'image/jpeg' },
      };
    },
    async del(pathname: string | string[], options: Record<string, unknown>) {
      calls.push({ name: 'del', args: [pathname, options] });
      if (Array.isArray(pathname)) {
        for (const name of pathname) objects.delete(name);
        return;
      }
      if (!objects.delete(pathname)) throw new BlobNotFoundError();
    },
    async list(options: { prefix?: string }) {
      calls.push({ name: 'list', args: [options] });
      return {
        blobs: [...objects.keys()]
          .filter((name) => name.startsWith(options.prefix ?? ''))
          .map((pathname) => ({ pathname, uploadedAt: uploadedAt.get(pathname) ?? new Date() })),
        hasMore: false,
      };
    },
    async issueSignedToken(options: Record<string, unknown>) {
      calls.push({ name: 'issueSignedToken', args: [options] });
      return {
        delegationToken: delegation,
        clientSigningToken: 'k',
        validUntil: options.validUntil,
      };
    },
    async presignUrl(_token: unknown, options: Record<string, unknown>) {
      calls.push({ name: 'presignUrl', args: [options] });
      return { presignedUrl: `https://vercel.com/api/blob/?pathname=${options.pathname}&sig=x` };
    },
  } as unknown as VercelBlobClient;
  return { client, objects, calls, uploadedAt };
}

test('Vercel Blob storage needs a connected private store', () => {
  assert.throws(() => vercelBlobConfiguration({}), /private Blob store/);
  assert.deepEqual(vercelBlobConfiguration({ BLOB_STORE_ID: 'store123' }), {
    storeId: 'store123',
  });
  assert.deepEqual(vercelBlobConfiguration(environment), {
    token: environment.BLOB_READ_WRITE_TOKEN,
  });
  assert.ok(getStorage({ PHOTO_STORAGE: 'vercel-blob', ...environment }));
});

test('Vercel Blob storage keeps photos private and never overwrites', async () => {
  const { client, objects, calls } = fakeClient();
  const storage = createVercelBlobStorage(environment, client);
  const bytes = Buffer.from('jpeg bytes');
  await storage.write(original, bytes, 'image/jpeg');
  const put = calls.find((call) => call.name === 'put')!.args[1] as Record<string, unknown>;
  assert.equal(put.access, 'private');
  assert.equal(put.allowOverwrite, false);
  assert.equal(put.addRandomSuffix, false);
  await assert.rejects(storage.write(original, bytes, 'image/jpeg'));
  await assert.rejects(storage.write(original, bytes, 'image/png'));
  assert.deepEqual(await storage.read(original), { bytes, contentType: 'image/jpeg' });
  const get = calls.find((call) => call.name === 'get')!.args[1] as Record<string, unknown>;
  assert.equal(get.access, 'private');
  assert.equal(get.useCache, false);
  assert.equal(await storage.read(key), null);
  await storage.delete(original);
  await storage.delete(original);
  assert.equal(objects.size, 0);
  await assert.rejects(storage.read('../secrets.jpg'));
});

test('Vercel Blob uploads and downloads use short, single-object signed links', async () => {
  const { client, calls } = fakeClient();
  const storage = createVercelBlobStorage(environment, client);
  const upload = await storage.signUpload!(key, 1234, 'image/jpeg');
  assert.match(upload.url, /^https:\/\/vercel\.com\/api\/blob\//);
  assert.deepEqual(upload.headers, {
    'x-api-version': '13',
    'x-vercel-blob-access': 'private',
    'x-content-type': 'image/jpeg',
    'x-vercel-blob-store-id': 'store123',
  });
  const issued = calls.find((call) => call.name === 'issueSignedToken')!.args[0] as Record<
    string,
    unknown
  >;
  assert.equal(issued.pathname, key);
  assert.deepEqual(issued.operations, ['put']);
  assert.deepEqual(issued.allowedContentTypes, ['image/jpeg']);
  assert.equal(issued.maximumSizeInBytes, 1234);
  assert.ok((issued.validUntil as number) <= Date.now() + 300_000);
  const presigned = calls.find((call) => call.name === 'presignUrl')!.args[0] as Record<
    string,
    unknown
  >;
  assert.equal(presigned.allowOverwrite, false);
  assert.equal(presigned.access, 'private');

  await assert.rejects(storage.signUpload!(original, 1234, 'image/jpeg'), /Invalid photo upload/);
  await assert.rejects(storage.signUpload!(key, 11 * 1024 * 1024, 'image/jpeg'));
  await assert.rejects(storage.signUpload!(key, 1234, 'image/png'));

  const download = await storage.signDownload!(original);
  assert.match(download, /pathname=originals\//);
  const getToken = calls.filter((call) => call.name === 'issueSignedToken')[1]!.args[0] as Record<
    string,
    unknown
  >;
  assert.deepEqual(getToken.operations, ['get']);
  assert.ok((getToken.validUntil as number) <= Date.now() + 60_000);
  await assert.rejects(storage.signDownload!(key), /Invalid original photo/);
});

test('interrupted uploads left in staging are swept after a day', async () => {
  const { client, objects, uploadedAt } = fakeClient();
  const storage = createVercelBlobStorage(environment, client);
  const old = 'staging/11111111-1111-4111-8111-111111111111.jpg';
  const fresh = 'staging/22222222-2222-4222-8222-222222222222.jpg';
  for (const name of [old, fresh, original]) objects.set(name, Buffer.from('x'));
  uploadedAt.set(old, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
  uploadedAt.set(original, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  assert.equal(await storage.removeStaleStaging!(24 * 60 * 60 * 1000), 1);
  assert.deepEqual([...objects.keys()].sort(), [fresh, original].sort());
});
