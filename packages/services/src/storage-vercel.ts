import {
  BlobNotFoundError,
  del,
  get,
  issueSignedToken,
  list,
  parseStoreIdFromDelegationToken,
  presignUrl,
  put,
} from '@vercel/blob';
import type { Environment } from './config';
import {
  contentTypeFor,
  MAX_PHOTO_BYTES,
  validWrite,
  validateStorageKey,
  type ImageContentType,
  type PrivateStorage,
} from './storage-contract';

export { BlobNotFoundError };

const unavailable = 'Private photo storage is unavailable.';
/**
 * The Blob API version the pinned @vercel/blob SDK speaks. A browser uploading to a presigned
 * URL sends it the way the SDK's own client upload does; update it with the SDK.
 */
const BLOB_API_VERSION = '13';

export type VercelBlobClient = {
  put: typeof put;
  get: typeof get;
  del: typeof del;
  list: typeof list;
  issueSignedToken: typeof issueSignedToken;
  presignUrl: typeof presignUrl;
};
const sdk: VercelBlobClient = { put, get, del, list, issueSignedToken, presignUrl };

/**
 * A private Vercel Blob store connected to the project. On Vercel the SDK authenticates with the
 * deployment's OIDC token and BLOB_STORE_ID; elsewhere a store read-write token is required.
 */
export function vercelBlobConfiguration(environment: Environment) {
  const token = environment.BLOB_READ_WRITE_TOKEN?.trim() || undefined;
  const storeId = environment.BLOB_STORE_ID?.trim() || undefined;
  if (!token && !storeId)
    throw new Error(
      'Vercel Blob photo storage requires a private Blob store connected to the project (BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID).',
    );
  return { ...(token ? { token } : {}), ...(storeId && !token ? { storeId } : {}) };
}

async function boundedStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
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
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, bytes);
}

export function createVercelBlobStorage(
  environment: Environment,
  client: VercelBlobClient = sdk,
): PrivateStorage {
  const auth = vercelBlobConfiguration(environment);
  /** A delegation scoped to one object and operation, valid for `seconds`. */
  async function signed(
    key: string,
    operation: 'put' | 'get',
    seconds: number,
    upload?: { size: number; contentType: ImageContentType },
  ) {
    const validUntil = Date.now() + seconds * 1000;
    try {
      const token = await client.issueSignedToken({
        ...auth,
        pathname: key,
        operations: [operation],
        validUntil,
        ...(upload
          ? { allowedContentTypes: [upload.contentType], maximumSizeInBytes: upload.size }
          : {}),
      });
      const { presignedUrl } = await client.presignUrl(
        token,
        operation === 'put'
          ? {
              operation,
              pathname: key,
              access: 'private',
              validUntil,
              allowedContentTypes: [upload!.contentType],
              maximumSizeInBytes: upload!.size,
              allowOverwrite: false,
              addRandomSuffix: false,
            }
          : { operation, pathname: key, access: 'private', validUntil, useCache: false },
      );
      return { presignedUrl, storeId: parseStoreIdFromDelegationToken(token.delegationToken) };
    } catch {
      throw new Error(unavailable);
    }
  }
  return {
    async signUpload(key, size, contentType) {
      validateStorageKey(key);
      if (
        !key.startsWith('staging/') ||
        contentType !== contentTypeFor(key) ||
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > MAX_PHOTO_BYTES
      )
        throw new Error('Invalid photo upload.');
      const { presignedUrl, storeId } = await signed(key, 'put', 300, { size, contentType });
      // The browser PUTs the file as the SDK's own client upload would.
      return {
        url: presignedUrl,
        headers: {
          'x-api-version': BLOB_API_VERSION,
          'x-vercel-blob-access': 'private',
          'x-content-type': contentType,
          ...(storeId ? { 'x-vercel-blob-store-id': storeId } : {}),
        },
      };
    },
    async signDownload(key) {
      validateStorageKey(key);
      if (!key.startsWith('originals/')) throw new Error('Invalid original photo.');
      return (await signed(key, 'get', 60)).presignedUrl;
    },
    async write(key, bytes, contentType) {
      validWrite(key, bytes, contentType);
      try {
        await client.put(key, bytes, {
          ...auth,
          access: 'private',
          contentType,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          abortSignal: AbortSignal.timeout(20_000),
        });
      } catch {
        throw new Error(unavailable);
      }
    },
    async read(key) {
      validateStorageKey(key);
      let result;
      try {
        result = await client.get(key, {
          ...auth,
          access: 'private',
          useCache: false,
          abortSignal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw new Error(unavailable);
      }
      if (!result) return null;
      if (result.statusCode !== 200 || !result.stream) throw new Error(unavailable);
      if (result.blob.size > MAX_PHOTO_BYTES) throw new Error('Invalid private photo.');
      return { bytes: await boundedStream(result.stream), contentType: contentTypeFor(key) };
    },
    async removeStaleStaging(olderThanMs) {
      // Blob has no expiry rules: interrupted uploads are swept here instead.
      const cutoff = Date.now() - olderThanMs;
      const stale: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.list({ ...auth, prefix: 'staging/', cursor, limit: 1000 });
        for (const blob of page.blobs)
          if (new Date(blob.uploadedAt).getTime() < cutoff) stale.push(blob.pathname);
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      if (stale.length) await client.del(stale, auth);
      return stale.length;
    },
    async delete(key) {
      validateStorageKey(key);
      try {
        await client.del(key, { ...auth, abortSignal: AbortSignal.timeout(20_000) });
      } catch (error) {
        if (error instanceof BlobNotFoundError) return;
        throw new Error('Could not remove the private photo.');
      }
    },
  };
}
