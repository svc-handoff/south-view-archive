import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertServer, privateDataDirectory, type Environment } from './config';
import { createS3Storage, s3Configuration, type S3Storage } from './storage-s3';
import { createVercelBlobStorage } from './storage-vercel';
import {
  contentTypeFor,
  MAX_PHOTO_BYTES,
  validWrite,
  validateStorageKey,
  type PrivateStorage,
} from './storage-contract';

export * from './storage-contract';
export { createS3Storage, s3Configuration } from './storage-s3';
export { createVercelBlobStorage, vercelBlobConfiguration } from './storage-vercel';

export function createLocalStorage(directory: string): PrivateStorage {
  assertServer();
  return {
    async write(key, bytes, contentType) {
      validWrite(key, bytes, contentType);
      const filename = join(directory, key);
      await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
      await writeFile(filename, bytes, { flag: 'wx', mode: 0o600 });
    },
    async read(key) {
      validateStorageKey(key);
      const filename = join(directory, key);
      try {
        const details = await stat(filename);
        if (!details.isFile() || details.size > MAX_PHOTO_BYTES)
          throw new Error('Invalid private photo.');
        return { bytes: await readFile(filename), contentType: contentTypeFor(key) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async delete(key) {
      validateStorageKey(key);
      try {
        await unlink(join(directory, key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
  };
}

async function boundedBody(response: Response) {
  if (Number(response.headers.get('content-length')) > MAX_PHOTO_BYTES)
    throw new Error('Invalid private photo.');
  if (!response.body) throw new Error('Private photo is unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_PHOTO_BYTES) throw new Error('Invalid private photo.');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks, bytes);
}

export function createSupabaseStorage(
  environment: Environment,
  fetcher: typeof fetch = fetch,
): PrivateStorage {
  assertServer();
  const url = new URL(environment.SUPABASE_URL ?? '');
  const bucket = environment.SUPABASE_PRIVATE_BUCKET;
  const key = environment.SUPABASE_SERVICE_ROLE_KEY;
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !bucket ||
    !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucket) ||
    !key
  )
    throw new Error('Private Supabase storage is not configured.');
  const base = `${url.origin}/storage/v1`;
  const headers = { Authorization: `Bearer ${key}`, apikey: key };
  async function request(path: string, init: RequestInit = {}) {
    try {
      return await fetcher(`${base}${path}`, {
        ...init,
        headers: { ...headers, ...init.headers },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error('Private photo storage is unavailable.');
    }
  }
  async function checkPrivateBucket() {
    const response = await request(`/bucket/${bucket}`);
    if (!response.ok) throw new Error('Private photo storage is unavailable.');
    const metadata: unknown = await response.json();
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      !('public' in metadata) ||
      metadata.public !== false
    )
      throw new Error('Photo storage must use a private bucket.');
  }
  return {
    async write(objectKey, bytes, contentType) {
      validWrite(objectKey, bytes, contentType);
      await checkPrivateBucket();
      const response = await request(`/object/${bucket}/${objectKey}`, {
        method: 'POST',
        body: new Uint8Array(bytes),
        headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'x-upsert': 'false' },
      });
      if (!response.ok) throw new Error('Could not store the private photo.');
    },
    async read(objectKey) {
      validateStorageKey(objectKey);
      await checkPrivateBucket();
      const response = await request(`/object/${bucket}/${objectKey}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Private photo is unavailable.');
      return { bytes: await boundedBody(response), contentType: contentTypeFor(objectKey) };
    },
    async delete(objectKey) {
      validateStorageKey(objectKey);
      await checkPrivateBucket();
      const response = await request(`/object/${bucket}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [objectKey] }),
      });
      if (!response.ok && response.status !== 404)
        throw new Error('Could not remove the private photo.');
    },
  };
}

let cachedS3: { configuration: string; storage: S3Storage } | undefined;

export function getStorage(environment: Environment = process.env): PrivateStorage {
  const driver =
    environment.PHOTO_STORAGE ?? (environment.ARCHIVE_DATA_MODE === 'database' ? 's3' : 'local');
  if (driver === 's3') {
    // Reuse the SDK connection pool. These server-only values are never logged or serialized.
    const configuration = JSON.stringify(s3Configuration(environment));
    if (cachedS3?.configuration !== configuration) {
      cachedS3?.storage.close();
      cachedS3 = { configuration, storage: createS3Storage(environment) };
    }
    return cachedS3.storage;
  }
  if (driver === 'supabase') return createSupabaseStorage(environment);
  if (driver === 'vercel-blob') return createVercelBlobStorage(environment);
  if (driver !== 'local')
    throw new Error('PHOTO_STORAGE must be local, s3, vercel-blob, or supabase.');
  if (environment.NODE_ENV === 'production' && environment.ARCHIVE_DATA_MODE === 'database')
    throw new Error('Production database mode requires private object storage.');
  return createLocalStorage(join(privateDataDirectory(environment), 'photos'));
}
