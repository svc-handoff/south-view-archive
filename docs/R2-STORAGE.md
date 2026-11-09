# Cloudflare R2 and S3-compatible photo storage

The application uses the standard AWS SDK v3 S3 interface. The site used the **private Cloudflare R2 bucket `south-view-archive`** until 5 November 2026; it now uses a private Vercel Blob store ([VERCEL-BLOB-STORAGE.md](./VERCEL-BLOB-STORAGE.md)). This R2 setup still works with `PHOTO_STORAGE=s3`. Local development can still use a local photo directory by default.

## Uploads and public access

1. A guest or signed-in contributor first saves a private submission, then uploads JPEG, PNG, or WebP images through the website. Each submission accepts at most 5 photos, up to 10 MiB each.
2. In S3 mode, the website checks authorization and rate limits, then issues a five-minute upload URL for one random `staging/` object. The signature binds file size, type, and a no-overwrite condition. The browser uploads directly to R2 without sending its private receipt or account cookies to R2. After upload, the website rechecks access, the signed ticket, actual size, content, and pixel count, corrects orientation, and produces a JPEG without EXIF/XMP/IPTC, at most 2400 pixels on its longest edge and 4 MiB in size.
3. Originals are stored as `originals/UUID.ext`, and processed images as `processed/UUID.jpg`. **Both are in the same private bucket**. User-provided filenames are not used, and names/emails are not written to object metadata. An original may itself contain private metadata, so it is accessible only through an authorized private path.
4. Only staff-approved processed images are served through `/api/community/media/[photoId]`. The endpoint checks current publication state on every request and stops serving an image after withdrawal. Authorized original downloads use one-minute signed URLs. Secret S3 access keys remain on the server. A temporary signed URL is a short-lived credential for one object, not permission to list the bucket or read other objects.

Photo bytes upload directly from the browser, avoiding Vercel's 4.5 MB request limit. Configure CORS for only the actual HTTPS site origin, GET/PUT, and the `content-type` and `if-none-match` request headers. At most 20 upload URLs are issued per submission per hour. Temporary objects are removed after processing. A one-day expiry rule for only the `staging/` prefix cleans up interrupted uploads; **do not set automatic deletion on `originals/` or `processed/`**. Local and legacy Supabase storage still proxy uploads through the website. Failed uploads can be retried without rolling back saved text, and storage errors never silently fall back to local files.

## Create the R2 configuration

1. Enable R2 in your Cloudflare account and create a bucket such as `south-view-archive`.
2. Keep **Public Development URL (`r2.dev`) disabled** and do not enable a public **Custom Domain**. These are independent public-access paths; neither originals nor processed images may be exposed through either one. R2 is private by default, but the standard S3 API cannot inspect these Cloudflare settings. Verify them in the dashboard; a successful connection check is not proof of privacy. See [public-access documentation](https://developers.cloudflare.com/r2/buckets/public-buckets/).
3. Create R2 credentials with **Object Read & Write** permission scoped only to this bucket. Save the generated **Access Key ID** and **Secret Access Key**. These are S3 credentials: do not use a Cloudflare management API Bearer token as the secret access key. The application does not need permission to manage every bucket. See [credential setup](https://developers.cloudflare.com/r2/api/tokens/).
4. Copy the S3 API endpoint from the R2 dashboard. It is typically `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`; for a specific jurisdiction, use its supplied endpoint. Enter only the origin, without a bucket, object path, or query string.

## Server-side environment variables

Enter real values in **`apps/nextjs/.env.local`** or your deployment platform, replacing the existing `PHOTO_STORAGE=local` line with `s3` rather than leaving conflicting entries:

```dotenv
PHOTO_STORAGE=s3
S3_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=south-view-archive
S3_ACCESS_KEY_ID=YOUR_R2_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY=YOUR_R2_SECRET_ACCESS_KEY
S3_FORCE_PATH_STYLE=true
```

These placeholders are not valid credentials. All values are server-only: do not prefix them with `NEXT_PUBLIC_`, commit them, or paste secrets into chat. Restart after configuration changes. You can test R2 with `ARCHIVE_DATA_MODE=local`; production with multiple instances continues to use `ARCHIVE_DATA_MODE=database` and PostgreSQL.

If `PHOTO_STORAGE` is omitted, database mode defaults to `s3`; other modes default to `local`. Once `s3` is selected, missing or invalid values among its five required settings cause an error. The application does not borrow a system AWS profile, switch buckets, or fall back to local storage. `fixture` remains read-only. Existing `PHOTO_STORAGE=supabase` deployments can explicitly retain the legacy adapter.

## Verify the real connection

Put the same S3 settings in the **repository-root `.env.local`**, or in the process environment, and run:

```powershell
pnpm storage:check
```

The script loads settings in this order of precedence: process variables, root `.env.local`, root `.env`. It does not read the web application's environment file or open PGlite, so the website does not need to be stopped. It generates a 2×2 PNG and a processed JPEG, writes them under random keys, reads and compares the bytes, deletes them, and confirms they can no longer be read. It uses no real submission attachments and creates no public records. Success prints `S3 photo write, read-back, and delete passed`. If cleanup fails, it reports only this test's random keys so an operator can remove them in the console.

A timeout or interrupted connection can leave the client uncertain whether the server saved an object. Such writes may leave objects without database records; the review workflow does not publish them. Diagnostics omit secrets. Use the Cloudflare console and deployment logs to check the endpoint, credentials, permissions, bucket name, and network. Do not resolve a 403 by enabling public access.

After the connection check, test the full sequence: guest photo submission → private receipt → staff publication → anonymous public viewing → withdrawal and image 404. Also confirm that a request without a receipt cannot read a pending original. This checks application authorization; bucket public-access settings still need separate verification.

## Other S3 providers

- Replace the endpoint, region, bucket, and credentials to use another compatible service. AWS S3 uses its actual region, such as `us-east-1`; R2 uses `auto`.
- `S3_FORCE_PATH_STYLE=true` uses `/bucket/key`, suitable for R2 and common compatible stores. `false` uses the provider's supported bucket-subdomain addressing.
- Temporary credentials can include `S3_SESSION_TOKEN`. The S3 credentials generated by ordinary R2 API tokens do not require it.
- Production requires HTTPS. In `NODE_ENV=development` or `test`, local MinIO can use a loopback address such as `http://127.0.0.1:9000`. Remote HTTP is always rejected.
- The service must support signed Put/Get/Delete Object requests and `PutObject` with `If-None-Match: *` to prevent overwriting an existing key. The code sends no object ACL and does not depend on bucket-management APIs. R2 supports these operations; run the connection check for other services claiming S3 compatibility. See the [R2 compatibility table](https://developers.cloudflare.com/r2/api/s3/api/).

## Migrating existing photos

The database stores `originals/...` and `processed/...` object keys. Public media URLs contain no provider address, so **no SQL migration or permanent-link change is required**. Changing environment variables does not copy existing attachments, however, and the runtime reads only the selected store.

Before migration, pause uploads and attachment deletion, and back up the database and original storage. Use a controlled migration tool to copy both directories from `.southview/photos/` or the old Supabase bucket into R2. Preserve every key and content type: `.jpg` is `image/jpeg`, `.png` is `image/png`, and `.webp` is `image/webp`. Set `Cache-Control: no-store`. Do not upload the `.southview` database, authentication secret, or outbox. Retain an independent backup of the old store for comparison; do not automatically delete the source files.

Confirm that every database attachment reference is readable from the destination and byte-identical. Then switch the website's configuration, test private receipts and published photos, and resume submissions. Do not migrate only public JPEGs while omitting private originals. Neither `originals/` nor `processed/` is disposable; both are part of the permanent archive. This delivery did not perform a migration of existing real user attachments.

## Completed and outstanding verification

Isolated tests exercised real SDK signing/serialization and the connection-check workflow against a local HTTP S3 endpoint. Coverage includes conditional writes, file validation, oversized/interrupted reads, authorization failures, missing buckets, original-file cleanup, and error redaction. On 2026-10-07, real R2 tests verified private-object write/read/delete and a 6,763,537-byte signed direct upload; overwrites and anonymous reads were rejected. The console confirmed that the development URL was disabled and no public domain was enabled.

Implementation references: [Cloudflare AWS SDK v3 example](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/), [R2 signed URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), and [Vercel function limits](https://vercel.com/docs/functions/limitations). These references were checked on 2026-10-07; this translation does not represent a new provider-policy or deployment audit.
