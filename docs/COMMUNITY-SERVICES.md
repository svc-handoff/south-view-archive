# Community services

`@southview/services` is a server package. Next route handlers use its authentication, private photo, upload-ticket, and vetting APIs; browser components must not import it. Node built-ins and Sharp remain on the server. The authentication route is `apps/nextjs/src/app/api/auth/[...all]/route.ts` and uses the Node runtime.

## Authentication and access

Better Auth and its standalone Drizzle adapter are pinned to 1.7.7. Google OAuth is the only account sign-in: it needs its server-side client ID and secret plus valid base authentication configuration. Email-code sign-in and all outgoing mail were removed on 2026-10-28; the application sends no email. Guest contributions remain available without signing in.

Google requests only `openid email profile` with online access. Use a dedicated Web application OAuth client and server-only `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. The callback is the exact `BETTER_AUTH_URL` origin followed by `/api/auth/callback/google`; locally it is `http://127.0.0.1:3000/api/auth/callback/google`. Existing accounts may be linked only when the local and provider emails match and both are verified. Neither a matching display name nor an email domain grants access. Guest claims still require the original receipt and matching verified contact email. See [Google setup and live-validation boundaries](./GOOGLE-AUTH.md).

The database holds both session records and rate-limit counters. Session cookies are HTTP-only, SameSite=Lax, and secure when the configured site uses HTTPS. Staff permission is a separate private `community.reviewers` record, never a sign-up input or email-domain inference.

`getAuth()` initializes against `await getStore()`; `getSession(headers)` returns a verified server session or null. `isReviewer(userId)` checks the private reviewer table. Migration `0003_auth.sql` creates the private auth tables, enables RLS, and removes public/anonymous/authenticated database grants. The server's owner-level database connection performs these operations. Do not expose the `community` schema through a client database API.

Set `BETTER_AUTH_URL` to the exact site origin. It falls back to `NEXT_PUBLIC_SITE_URL`, or `http://127.0.0.1:3000` only in development/test. HTTPS and a `BETTER_AUTH_SECRET` of at least 32 bytes are required outside development/test. Local development creates one random secret in `.southview/auth-secret`; it survives restarts and is never returned by an endpoint. Use the same origin in the browser and environment; localhost and 127.0.0.1 are different origins.

After a staff member signs in through Google with a verified email, an operator can grant access from the private server environment. With local PGlite, stop the development server first, run the command, then restart the server: the private database admits one owning process at a time.

```sh
pnpm --filter @southview/services grant-reviewer --email staff@example.org --confirm
```

Use `--revoke` to remove access. A process with `NODE_ENV=production` also requires `--allow-production`. The command finds an existing verified account; it does not create accounts or mail anyone. No HTTP endpoint grants staff roles.

## No email

The archive does not send email. Contributors receive their private receipt link on screen after sending a story, and review decisions, information requests, and publication appear on that page. Reviewers who need a contributor's attention should write a clear message in the review dialog and expect a reply only when the contributor returns. The private contact email collected with each submission is for staff use outside the application. The legacy `community.mail_events` table and `submissions.mail_status` column remain in older databases but are no longer read or written.

Deploy behind a reverse proxy that removes untrusted incoming forwarding headers before supplying the real client address. Both authentication and community routes read a forwarded client address only when `TRUST_PROXY=1`; without it, requests share a conservative rate-limit bucket.

## Private photographs

`processPhoto(bytes)` accepts JPEG, PNG, and WebP up to 10 MiB. It checks magic bytes, decodes the image with a 40-million-pixel limit, rejects animated images, applies orientation, resizes to at most 2400 pixels on either axis, and emits JPEG. EXIF, XMP, IPTC, and other source metadata are not copied. SVG and corrupt or oversized inputs are rejected. The original remains private for staff review; only a processed copy may become public after approval.

`savePhoto(bytes)` generates opaque UUID keys under `originals/` and `processed/`, saves both privately, and returns keys/dimensions/types to the repository layer. Original filenames are not used. If the second storage write fails, the service attempts to remove the first. Routes clean up stored files if attaching their database record fails. Private storage keys must never be serialized into public DTOs.

`getStorage()` selects `PHOTO_STORAGE=local|s3|vercel-blob|supabase`; the deployed site uses `vercel-blob` (see [Vercel Blob photo storage](./VERCEL-BLOB-STORAGE.md)). Database mode defaults to `s3`; other modes default to `local`. Production database mode rejects local photo storage, and no adapter falls back on configuration or network failures. Local storage is under `.southview/photos/`, outside the public tree. `SOUTHVIEW_DATA_DIR` overrides the shared private root for the database, local photos, and local secret. A local deployment must preserve this directory across restarts. Database and photo providers are independent: PGlite can use R2 during development, and Supabase PostgreSQL does not require Supabase Storage.

The primary cloud adapter uses pinned `@aws-sdk/client-s3` 3.1146.0 with explicit `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`. R2 uses region `auto`; `S3_FORCE_PATH_STYLE` defaults to `true`. Optional `S3_SESSION_TOKEN` supports temporary credentials for other providers. It never consults the ambient AWS credential chain. Credentials are server-only; HTTPS is required except loopback HTTP in development/test. The SDK signs requests with SigV4, uses at most two attempts and a 20-second operation deadline, refuses region redirects, and uses conditional writes (`If-None-Match: *`). Only required SDK checksums are enabled for R2 compatibility. There are no ACL or public-bucket API calls.

Operators create the **private** R2 bucket beforehand and disable both `r2.dev` access and public custom domains. **R2's S3 API cannot verify these Cloudflare public-access settings.** The application does not create or publish buckets; use the provider console to check their privacy. Both `originals/` and `processed/` stay private. No signed URLs, object-store URLs, or keys are returned to users. Browser uploads still go through the Next server for authorization, limits, image decoding, and metadata removal; R2 browser CORS is unnecessary. The public media route first confirms the photo is selected in a currently published contribution, then serves the processed bytes with `no-store`. Withdrawal removes that authorization. Downloaded bodies are bounded by actual bytes as well as metadata; missing objects return null while missing buckets and access failures remain errors.

See [R2 setup, storage probe, and migration](./R2-STORAGE.md). `pnpm storage:check` tests write/read/delete using only generated probe images; it does not open the database or verify bucket privacy. Existing object keys and public media addresses are unchanged; there is no SQL migration. Switching adapters does not copy old files.

The explicit legacy `PHOTO_STORAGE=supabase` adapter remains available with `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_PRIVATE_BUCKET`. It checks Supabase bucket metadata on each operation and refuses public buckets. This Supabase-specific check is not available in the generic S3/R2 API. No live R2/Supabase project was configured or contacted for the automated tests.

## Validation and references

`tests/services.test.ts` exercises a mocked Google session lifecycle against an isolated PGlite database, secret persistence, private storage path checks, partial-write cleanup, MIME validation, image orientation, and metadata removal. The test outbox and images remain under ignored `.southview/tests/` and are removed after the tests.

`tests/s3-storage.test.ts` exercises the real SDK serialization/signing with an isolated transport, conditional writes, R2 checksum compatibility, alternate endpoint addressing, invalid configuration, missing objects versus bucket failures, bounded/interrupted streams, and partial-write cleanup. The storage probe also runs in a subprocess against a local HTTP S3 test endpoint and leaves no objects behind. These tests do not establish that actual Cloudflare credentials or bucket privacy are correct.

Implementation references checked on 2026-10-03:

- [Better Auth Google provider](https://better-auth.com/docs/authentication/google); the project-specific setup guide documents the official Google Console references. No real Google Cloud client or credentials have been configured, and simulated OAuth tests do not confirm a live Google authorization or callback.
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [database schema](https://better-auth.com/docs/concepts/database), [rate limiting](https://better-auth.com/docs/concepts/rate-limit), and [request hooks](https://better-auth.com/docs/concepts/hooks).
- [Supabase private downloads](https://supabase.com/docs/guides/storage/serving/downloads) and the [official storage client's authenticated request paths](https://github.com/supabase/storage-js/blob/master/src/packages/StorageFileApi.ts).
- [Cloudflare R2 with the AWS SDK v3](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/), [S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/), [R2 credentials](https://developers.cloudflare.com/r2/api/tokens/), and [public access settings](https://developers.cloudflare.com/r2/buckets/public-buckets/).
- [Sharp constructor limits](https://sharp.pixelplumbing.com/api-constructor/) and [output metadata behavior](https://sharp.pixelplumbing.com/api-output/).
- Installed Next.js 16.3.8 route-handler documentation in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`.
