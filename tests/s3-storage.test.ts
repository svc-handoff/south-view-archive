import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { savePhoto } from '@southview/services/photos';
import {
  createS3Storage,
  getStorage,
  MAX_PHOTO_BYTES,
  s3Configuration,
} from '@southview/services/storage';

const environment = {
  NODE_ENV: 'test',
  PHOTO_STORAGE: 's3',
  S3_ENDPOINT: 'https://test-account.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'southview-private',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
};

test('direct upload signatures bind length, MIME type, and no-overwrite; downloads expire quickly', async () => {
  const storage = createS3Storage(environment);
  try {
    const key = `staging/${randomUUID()}.png`;
    const signed = await storage.signUpload!(key, MAX_PHOTO_BYTES, 'image/png');
    const url = new URL(signed.url);
    assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
    const headers = url.searchParams.get('X-Amz-SignedHeaders')!.split(';');
    for (const header of ['content-length', 'content-type', 'if-none-match'])
      assert.ok(headers.includes(header));
    assert.deepEqual(signed.headers, { 'Content-Type': 'image/png', 'If-None-Match': '*' });
    assert.ok(!signed.url.includes(environment.S3_SECRET_ACCESS_KEY));
    await assert.rejects(
      storage.signUpload!(`originals/${randomUUID()}.png`, 10, 'image/png'),
      /Invalid/,
    );
    await assert.rejects(storage.signUpload!(key, MAX_PHOTO_BYTES + 1, 'image/png'), /Invalid/);
    await assert.rejects(storage.signUpload!(key, 10, 'image/jpeg'), /Invalid/);
    const download = new URL(await storage.signDownload!(`originals/${randomUUID()}.png`));
    assert.equal(download.searchParams.get('X-Amz-Expires'), '60');
    assert.equal(download.searchParams.get('response-cache-control'), 'private, no-store');
    await assert.rejects(storage.signDownload!(key), /Invalid/);
  } finally {
    storage.close();
  }
});
type Request = {
  method: string;
  path: string;
  hostname: string;
  headers: Record<string, string>;
  body?: unknown;
};
function response(
  statusCode: number,
  body = Buffer.alloc(0),
  headers: Record<string, string> = {},
) {
  return { response: { statusCode, headers, body: Readable.from([body]) } };
}
function failure(statusCode: number, code: string) {
  return response(
    statusCode,
    Buffer.from(
      `<Error><Code>${code}</Code><Message>private upstream diagnostic</Message></Error>`,
    ),
    {
      'content-type': 'application/xml',
    },
  );
}

test('S3 configuration is explicit, validates endpoints, and never falls back to local storage', () => {
  const configured = s3Configuration(environment);
  assert.equal(configured.region, 'auto');
  assert.equal(configured.forcePathStyle, true);
  assert.equal(
    s3Configuration({ ...environment, S3_FORCE_PATH_STYLE: 'false' }).forcePathStyle,
    false,
  );
  assert.equal(
    s3Configuration({ ...environment, S3_SESSION_TOKEN: 'temporary-session' }).credentials
      .sessionToken,
    'temporary-session',
  );
  for (const field of [
    'S3_ENDPOINT',
    'S3_REGION',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ]) {
    assert.throws(
      () => createS3Storage({ ...environment, [field]: undefined }),
      /requires S3_ENDPOINT/,
    );
  }
  for (const endpoint of [
    'http://remote.example.org',
    'ftp://bucket.example.org',
    'https://secret:password@example.org',
    'https://example.org/private',
    'https://example.org/?key=secret',
    'https://example.org/#secret',
  ]) {
    assert.throws(
      () => createS3Storage({ ...environment, S3_ENDPOINT: endpoint }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!error.message.includes('password') && !error.message.includes('key=secret'));
        return true;
      },
    );
  }
  assert.equal(
    s3Configuration({ ...environment, S3_ENDPOINT: 'http://127.0.0.1:9000' }).endpoint,
    'http://127.0.0.1:9000',
  );
  assert.throws(() =>
    createS3Storage({
      ...environment,
      NODE_ENV: 'production',
      S3_ENDPOINT: 'http://127.0.0.1:9000',
    }),
  );
  for (const bucket of ['ab', '127.0.0.1', 'private/bucket', 'a..b', 'Private', 'a.-b'])
    assert.throws(() => createS3Storage({ ...environment, S3_BUCKET: bucket }));
  assert.throws(() => createS3Storage({ ...environment, S3_FORCE_PATH_STYLE: 'yes' }));
  assert.throws(() => getStorage({ ARCHIVE_DATA_MODE: 'database' }), /requires S3_ENDPOINT/);
  assert.throws(
    () =>
      getStorage({ ARCHIVE_DATA_MODE: 'database', NODE_ENV: 'production', PHOTO_STORAGE: 'local' }),
    /requires private object storage/,
  );
  assert.throws(() => getStorage({ PHOTO_STORAGE: 'typo' }), /PHOTO_STORAGE/);
});

test('S3 SDK signs R2 uploads, retains private keys, refuses overwrites, and reads/deletes bytes', async (t) => {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const requests: Request[] = [];
  const storage = createS3Storage(environment, {
    requestHandler: {
      async handle(request: Request) {
        requests.push(request);
        assert.equal(request.hostname, 'test-account.r2.cloudflarestorage.com');
        assert.match(request.headers.authorization!, /^AWS4-HMAC-SHA256 /);
        assert.match(request.headers.authorization!, /\/auto\/s3\/aws4_request/);
        assert.ok(!JSON.stringify(request).includes(environment.S3_SECRET_ACCESS_KEY));
        assert.ok(request.path.startsWith('/southview-private/'));
        if (request.method === 'PUT') {
          assert.equal(request.headers['if-none-match'], '*');
          assert.equal(request.headers['cache-control'], 'no-store');
          assert.equal(request.headers['x-amz-acl'], undefined);
          assert.equal(request.headers['x-amz-checksum-crc32'], undefined);
          assert.equal(request.headers['x-amz-sdk-checksum-algorithm'], undefined);
          assert.ok(!Object.keys(request.headers).some((key) => key.startsWith('x-amz-meta-')));
          if (objects.has(request.path)) return failure(412, 'PreconditionFailed');
          const bytes = Buffer.from(request.body as Uint8Array);
          assert.equal(request.headers['content-length'], String(bytes.length));
          objects.set(request.path, { bytes, contentType: request.headers['content-type']! });
          return response(200);
        }
        if (request.method === 'DELETE') {
          objects.delete(request.path);
          return response(204);
        }
        const object = objects.get(request.path);
        return object
          ? response(200, object.bytes, {
              'content-type': object.contentType,
              'content-length': String(object.bytes.length),
            })
          : failure(404, 'NoSuchKey');
      },
    },
  });
  t.after(() => storage.close());
  const key = `originals/${randomUUID()}.png`;
  const bytes = Buffer.from([137, 80, 78, 71]);
  await storage.write(key, bytes, 'image/png');
  assert.deepEqual(await storage.read(key), { bytes, contentType: 'image/png' });
  await assert.rejects(storage.write(key, Buffer.from([9]), 'image/png'), /unavailable/);
  assert.deepEqual((await storage.read(key))!.bytes, bytes);
  await storage.delete(key);
  assert.equal(await storage.read(key), null);
  await storage.delete(key);
  const count = requests.length;
  await assert.rejects(storage.write('../secret', bytes, 'image/png'), /Invalid/);
  await assert.rejects(storage.read('../secret'), /Invalid/);
  await assert.rejects(storage.delete('../secret'), /Invalid/);
  await assert.rejects(storage.write(key, bytes, 'image/jpeg'), /type/);
  await assert.rejects(storage.write(key, Buffer.alloc(0), 'image/png'), /10 MB/);
  await assert.rejects(storage.write(key, Buffer.alloc(MAX_PHOTO_BYTES + 1), 'image/png'), /10 MB/);
  assert.equal(requests.length, count);
});

test('S3 virtual-host addressing is available for other compatible providers', async (t) => {
  const storage = createS3Storage(
    {
      ...environment,
      S3_ENDPOINT: 'https://s3.example.org',
      S3_REGION: 'us-east-1',
      S3_FORCE_PATH_STYLE: 'false',
    },
    {
      requestHandler: {
        async handle(request: Request) {
          assert.equal(request.hostname, 'southview-private.s3.example.org');
          assert.match(request.path, /^\/processed\//);
          assert.match(request.headers.authorization!, /\/us-east-1\/s3\/aws4_request/);
          return failure(404, 'NoSuchKey');
        },
      },
    },
  );
  t.after(() => storage.close());
  assert.equal(await storage.read(`processed/${randomUUID()}.jpg`), null);
});

test('S3 failures remain failures without leaking credentials or treating a missing bucket as a missing image', async (t) => {
  for (const [status, code] of [
    [403, 'AccessDenied'],
    [404, 'NoSuchBucket'],
    [500, 'InternalError'],
    [301, 'PermanentRedirect'],
  ] as const) {
    const storage = createS3Storage(environment, {
      requestHandler: {
        async handle() {
          return failure(status, code);
        },
      },
    });
    t.after(() => storage.close());
    const key = `processed/${randomUUID()}.jpg`;
    for (const operation of [
      () => storage.read(key),
      () => storage.write(key, Buffer.from([1]), 'image/jpeg'),
      () => storage.delete(key),
    ]) {
      await assert.rejects(operation, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /unavailable/);
        assert.ok(
          !error.message.includes('private upstream') &&
            !error.message.includes(environment.S3_ACCESS_KEY_ID),
        );
        return true;
      });
    }
  }
});

test('S3 reads bound actual streamed bytes, validate metadata/length, and release rejected bodies', async (t) => {
  const cases: { chunks: Buffer[]; headers: Record<string, string> }[] = [
    { chunks: [Buffer.from([1])], headers: { 'content-length': String(MAX_PHOTO_BYTES + 1) } },
    { chunks: [Buffer.alloc(MAX_PHOTO_BYTES), Buffer.from([1])], headers: {} },
    { chunks: [Buffer.from([1])], headers: { 'content-length': '2' } },
    { chunks: [], headers: {} },
    { chunks: [Buffer.from([1])], headers: { 'content-type': 'image/png' } },
    { chunks: [Buffer.from([1])], headers: { 'content-encoding': 'gzip' } },
  ];
  for (const item of cases) {
    const body = Readable.from(item.chunks);
    const storage = createS3Storage(environment, {
      requestHandler: {
        async handle() {
          return {
            response: {
              statusCode: 200,
              headers: { 'content-type': 'image/jpeg', ...item.headers },
              body,
            },
          };
        },
      },
    });
    t.after(() => storage.close());
    await assert.rejects(storage.read(`processed/${randomUUID()}.jpg`), /unavailable/);
    assert.equal(body.destroyed, true);
  }
});

test('S3 accepts bounded chunked responses and rejects interrupted streams', async (t) => {
  for (const interrupted of [false, true]) {
    const storage = createS3Storage(environment, {
      requestHandler: {
        async handle() {
          return {
            response: {
              statusCode: 200,
              headers: { 'content-type': 'image/jpeg' },
              body: Readable.from(
                (async function* () {
                  yield Buffer.from([1, 2]);
                  if (interrupted) throw new Error('private network details');
                  yield Buffer.from([3]);
                })(),
              ),
            },
          };
        },
      },
    });
    t.after(() => storage.close());
    const read = storage.read(`processed/${randomUUID()}.jpg`);
    if (interrupted) await assert.rejects(read, /unavailable/);
    else assert.deepEqual((await read)!.bytes, Buffer.from([1, 2, 3]));
  }
});

test('the photo pipeline removes an original from S3 when its processed upload fails', async (t) => {
  const calls: Request[] = [];
  const storage = createS3Storage(environment, {
    requestHandler: {
      async handle(request: Request) {
        calls.push(request);
        if (request.method === 'PUT' && request.path.includes('/processed/'))
          return failure(403, 'AccessDenied');
        return response(request.method === 'DELETE' ? 204 : 200);
      },
    },
  });
  t.after(() => storage.close());
  const requireService = createRequire(
    new URL('../packages/services/package.json', import.meta.url),
  );
  const sharp = requireService('sharp');
  const input = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
  await assert.rejects(savePhoto(input, storage), /unavailable/);
  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((call) => call.method),
    ['PUT', 'PUT', 'DELETE'],
  );
  assert.equal(calls[2]!.path, calls[0]!.path);
});

test('the storage check command completes a real HTTP round trip and leaves no probe objects', async (t) => {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const methods: string[] = [];
  const server = createServer(async (request, result) => {
    try {
      const path = request.url!.split('?')[0]!;
      assert.match(
        path,
        /^\/southview-private\/(originals|processed|staging)\/[\da-f-]{36}\.(png|jpg)$/,
      );
      // Like R2: signed by header or by a presigned query string, or refused.
      const presigned = request.url!.includes('X-Amz-Signature=');
      if (!presigned && !/^AWS4-HMAC-SHA256 /.test(request.headers.authorization ?? '')) {
        result.writeHead(403).end();
        return;
      }
      methods.push(request.method!);
      if (request.method === 'PUT') {
        assert.equal(request.headers['if-none-match'], '*');
        if (objects.has(path)) {
          result.writeHead(412).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk);
        objects.set(path, {
          bytes: Buffer.concat(chunks),
          contentType: request.headers['content-type']!,
        });
        result.writeHead(200).end();
      } else if (request.method === 'DELETE') {
        objects.delete(path);
        result.writeHead(204).end();
      } else if (objects.has(path)) {
        const object = objects.get(path)!;
        result
          .writeHead(200, {
            'content-type': object.contentType,
            'content-length': String(object.bytes.length),
          })
          .end(object.bytes);
      } else {
        result
          .writeHead(404, { 'content-type': 'application/xml' })
          .end('<Error><Code>NoSuchKey</Code></Error>');
      }
    } catch {
      result.writeHead(500).end();
    }
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const executed = await promisify(execFile)(
    process.execPath,
    ['--import', 'tsx', 'packages/services/script/check-storage.ts'],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: {
        ...process.env,
        ...environment,
        S3_ENDPOINT: `http://127.0.0.1:${address.port}`,
        S3_FORCE_PATH_STYLE: 'true',
        S3_SESSION_TOKEN: '',
      },
      timeout: 30_000,
    },
  );
  assert.match(executed.stdout, /write and read back/);
  assert.match(executed.stdout, /unsigned address is refused \(403\)/);
  assert.match(executed.stdout, /signed direct upload works and cannot overwrite/);
  assert.match(executed.stdout, /Photo storage check passed/);
  assert.equal(objects.size, 0);
  assert.equal(methods.filter((method) => method === 'DELETE').length, 3);
});
