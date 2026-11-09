# Vercel deployment

Production URL: <https://south-view-archive.vercel.app/explore>.

## Review desk release · 2026-10-19

The completed review desk and Luna/web-search integration were deployed from source commit `5fd822c7a3ab2404d269dbdac1e8fb1977304f24` as **`dpl_BpqQS7661qCGY2w3KKsdTxaEsfhu`**. The production alias remains unchanged; the deployment URL is <https://south-view-archive-owvyzt0bf-junhui-huangs-projects.vercel.app>. Vercel's production build and TypeScript checks passed.

Versioned migration `0005_vet.sql` was applied to the existing Supabase database using the existing local migration connection. The private Vet table has RLS enabled and contained zero runs at verification. No local test submissions, accounts, photos, or mail were imported. The source and release record are tracked in the existing private GitHub repository. GitHub publishing does not itself configure automatic Vercel deployments.

After publication, `/explore`, `/stories` (since removed), `/people/john-lewis`, `/contribute`, and `/admin/contributions` returned HTTP 200. The session endpoint confirmed database mode. Unauthenticated `/api/community/review` and `/api/community/review/vet` returned private/no-store HTTP 403 responses without report data. The pages contained no isolated QA submissions or simulated reports.

Production still has no Google OAuth or SMTP configuration, so account sign-in and staff web review require a real sign-in method and a reviewer grant. `OPENAI_API_KEY` is also intentionally not configured yet: real Vet calls remain disabled, and live Luna quality/latency have not been verified. See [AI vetting setup](AI-VETTING.md). Guest submissions remain available. No production test contribution was created during this release verification.

On 2026-10-07, the application was deployed from local source using the Vercel CLI, without a GitHub connection, commit, or push at that time. A private source repository was subsequently created at [zilongpa/south-view-archive](https://github.com/zilongpa/south-view-archive) on 2026-10-19. Publishing that snapshot does not connect it to Vercel or trigger a deployment.

The map-hover fix was redeployed on 2026-10-07 as `dpl_A9DqTGvCGeC6LkBB6hRHZ9FS12Cv`; the production domain stayed unchanged. Vercel build and type checks passed, and the map, person, and contribution pages returned HTTP 200. Edge checks confirmed previews beside markers and detail-panel updates when moving keyboard focus, with viewport parameters preserved. Actual pointer-hover feel still needs manual review.

The resource descriptions below come from the earlier provisioning record; the release checks above are the later live audit.

## Provisioned resources

- Vercel: `junhui-huangs-projects/south-view-archive`, Next.js, application directory `apps/nextjs`, Node 24.x, pnpm 11.19.0, Washington DC build region.
- Supabase: a dedicated free database created through Vercel Marketplace in `iad1`. Versioned migrations and the public archive seed were applied. Local private submissions, accounts, and test mail were not migrated.
- Cloudflare R2: `south-view-archive`, Eastern North America, Standard storage. The public development URL is disabled, with no public custom domain. The `South-View Archive` account credential permits object read/write only for this bucket.
- R2 CORS: GET/PUT only from `https://south-view-archive.vercel.app`, allowing `content-type` and `if-none-match` headers. Only `staging/` has a one-day expiry; permanent originals and processed images do not expire automatically.

## Runtime configuration

Vercel Production uses `ARCHIVE_DATA_MODE=database`, `PHOTO_STORAGE=s3`, `S3_REGION=auto`, and `S3_FORCE_PATH_STYLE=true`. `DATABASE_URL` uses the Supabase transaction pooler on port 6543; migrations use a separate session-pooler connection on port 5432. The application disables prepared statements.

Both `NEXT_PUBLIC_SITE_URL` and `BETTER_AUTH_URL` are `https://south-view-archive.vercel.app`. The authentication secret was randomly generated and saved as a secret environment variable; S3 credentials and the database connection are also server-only. `TRUST_PROXY=1` relies on Vercel replacing externally supplied X-Forwarded-For headers; verify that assumption when moving to another platform. `ENABLE_EXPERIMENTAL_COREPACK=1` makes the build use the pnpm version pinned by the root packageManager field.

Google OAuth and SMTP were not configured, and `MAIL_MODE=disabled`. The deployed site supports guest text, link, and photo submissions and private-receipt follow-up without falsely claiming email delivery. Account sign-in and staff web review require at least one real sign-in method to be configured, followed by a reviewer grant. Do not describe all account and review workflows as live based on this deployment record.

## Redeploying

Run from the repository root:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm dlx vercel@62.5.0 deploy --prod --scope junhui-huangs-projects
```

On a new machine, sign in to Vercel first, then run `vercel link --project south-view-archive --scope junhui-huangs-projects`. `.vercel/` is local project-link configuration and must not be committed or distributed. `.vercelignore` excludes environment files, local databases, attachments, outbox messages, caches, and logs. Source ZIP exports also exclude `.vercel/`.

Only Production was configured. Set up a separate database, storage, and HTTPS origin for Preview rather than borrowing production data by default. Adding a domain requires matching changes to the site origin, R2 CORS, and Google callback addresses.

## Validation

The production build passed. Online map, person, and submission pages returned 200; unauthenticated review requests returned 403. Live tests covered text/link submissions, direct upload of a 6,763,777-byte photo, server decoding and EXIF removal, temporary private-original downloads, repeated upload completion, finalization, and follow-up in a new request. Unreviewed contributions and photos returned 404 from public endpoints. The test submission was never published; only its records and objects were removed afterward.

Live sign-in, SMTP delivery, staff publication, and backup/restore still need production verification. The existing cemetery website was not modified. See [EMBEDDING.md](EMBEDDING.md) for integration instructions.
