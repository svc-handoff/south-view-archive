import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertServer, isLocalEnvironment, type Environment } from './config';
import {
  contentTypeFor,
  MAX_PHOTO_BYTES,
  validWrite,
  validateStorageKey,
  type PrivateStorage,
} from './storage-contract';

const unavailable =
  'Private S3 photo storage is unavailable. Check the server configuration and bucket permissions.';

/** Validate without making requests or consulting ambient AWS credentials. */
export function s3Configuration(environment: Environment) {
  assertServer();
  try {
    const endpoint = new URL(environment.S3_ENDPOINT ?? '');
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if (
      (endpoint.protocol !== 'https:' &&
        !(endpoint.protocol === 'http:' && loopback && isLocalEnvironment(environment))) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== '/'
    )
      throw new Error();
    const bucket = environment.S3_BUCKET ?? '';
    if (
      !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
      bucket.includes('..') ||
      /\.-|-\./.test(bucket) ||
      /^\d+\.\d+\.\d+\.\d+$/.test(bucket)
    )
      throw new Error();
    const accessKeyId = environment.S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = environment.S3_SECRET_ACCESS_KEY?.trim();
    const region = environment.S3_REGION?.trim();
    const pathStyle = environment.S3_FORCE_PATH_STYLE ?? 'true';
    if (!accessKeyId || !secretAccessKey || !region || !['true', 'false'].includes(pathStyle))
      throw new Error();
    return {
      endpoint: endpoint.origin,
      bucket,
      region,
      forcePathStyle: pathStyle === 'true',
      credentials: {
        accessKeyId,
        secretAccessKey,
        ...(environment.S3_SESSION_TOKEN ? { sessionToken: environment.S3_SESSION_TOKEN } : {}),
      },
    };
  } catch {
    // Do not echo invalid URLs, secret values, or SDK diagnostics into route errors.
    throw new Error(
      'S3 photo storage requires S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY. Use an HTTPS origin and S3_FORCE_PATH_STYLE=true or false.',
    );
  }
}

export interface S3Storage extends PrivateStorage {
  close(): void;
}

export function createS3Storage(
  environment: Environment,
  options: { requestHandler?: S3ClientConfig['requestHandler'] } = {},
): S3Storage {
  const { bucket, ...configuration } = s3Configuration(environment);
  const client = new S3Client({
    ...configuration,
    maxAttempts: 2,
    followRegionRedirects: false,
    // R2 does not implement every checksum variant that recent AWS clients send by default.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: options.requestHandler ?? {
      connectionTimeout: 5_000,
      requestTimeout: 20_000,
      throwOnRequestTimeout: true,
    },
  });
  return {
    close() {
      client.destroy();
    },
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
      const headers = { 'Content-Type': contentType, 'If-None-Match': '*' };
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          ContentLength: size,
          IfNoneMatch: '*',
        }),
        {
          expiresIn: 300,
          signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']),
        },
      );
      return { url, headers };
    },
    async signDownload(key) {
      validateStorageKey(key);
      if (!key.startsWith('originals/')) throw new Error('Invalid original photo.');
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseCacheControl: 'private, no-store',
          ResponseContentDisposition: 'attachment; filename="original-photo"',
        }),
        { expiresIn: 60 },
      );
    },
    async write(key, bytes, contentType) {
      validWrite(key, bytes, contentType);
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bytes,
            ContentType: contentType,
            ContentLength: bytes.byteLength,
            CacheControl: 'no-store',
            IfNoneMatch: '*',
            // No ACL header: R2 does not implement object ACLs. Configure a private bucket.
          }),
          { abortSignal: AbortSignal.timeout(20_000) },
        );
      } catch {
        throw new Error(unavailable);
      }
    },
    async read(key) {
      validateStorageKey(key);
      const signal = AbortSignal.timeout(20_000);
      let body: Readable | undefined;
      const abort = () => body?.destroy(new Error('Private photo request timed out.'));
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal: signal,
        });
        if (!(response.Body instanceof Readable)) throw new Error();
        body = response.Body;
        signal.addEventListener('abort', abort, { once: true });
        signal.throwIfAborted();
        if (
          response.ContentType !== contentTypeFor(key) ||
          (response.ContentEncoding && response.ContentEncoding !== 'identity') ||
          (response.ContentLength !== undefined &&
            (!Number.isSafeInteger(response.ContentLength) ||
              response.ContentLength <= 0 ||
              response.ContentLength > MAX_PHOTO_BYTES))
        )
          throw new Error();
        let size = 0;
        const chunks: Uint8Array[] = [];
        for await (const chunk of body) {
          if (!(chunk instanceof Uint8Array)) throw new Error();
          size += chunk.byteLength;
          if (size > MAX_PHOTO_BYTES) throw new Error();
          chunks.push(chunk);
        }
        if (!size || (response.ContentLength !== undefined && size !== response.ContentLength))
          throw new Error();
        return { bytes: Buffer.concat(chunks, size), contentType: contentTypeFor(key) };
      } catch (error) {
        if (error instanceof Error && error.name === 'NoSuchKey') return null;
        throw new Error(unavailable);
      } finally {
        signal.removeEventListener('abort', abort);
        body?.destroy();
      }
    },
    async delete(key) {
      validateStorageKey(key);
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
          abortSignal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'NoSuchKey') return;
        throw new Error(unavailable);
      }
    },
  };
}
