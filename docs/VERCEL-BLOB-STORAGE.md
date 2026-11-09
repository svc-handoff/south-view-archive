# Vercel Blob photo storage

Since 5 November 2026 the deployed site keeps photographs in a **private Vercel Blob store** connected to the Vercel project, with Supabase PostgreSQL for the database. The earlier Cloudflare R2 setup ([R2-STORAGE.md](./R2-STORAGE.md)) still works and is selected with `PHOTO_STORAGE=s3`; switching stores does not change object keys, public media addresses or the database.

## How photos are stored

- Every file is private: `originals/UUID.ext` (the contributor's original, which may carry location metadata), `processed/UUID.jpg` (the metadata-free copy shown publicly) and `staging/UUID.ext` (an upload not yet processed).
- **Uploads go straight from the browser to Vercel**, avoiding the roughly 4.5 MB request limit of Vercel functions. The site issues a five-minute signed link for one `staging/` file, bound to its type and size and unable to overwrite anything. After the upload the site checks and processes the file as before.
- Approved public copies are served by `/api/community/media/[photoId]`, which checks on every request that the contribution is still published.
- Originals reach authorized people through a **one-minute signed link** for that one file. A Blob address without a signature is refused.
- Vercel Blob has no expiry rules, so the site removes `staging/` files older than a day itself, at most hourly, after an upload link is issued.

## Configuration

1. In the Vercel dashboard, **Storage → Create → Blob**, choose **Private**, and connect the store to the project for the Production (and, if wanted, Preview) environment. This adds `BLOB_READ_WRITE_TOKEN` (and `BLOB_STORE_ID`) to the project's environment variables.
2. Set `PHOTO_STORAGE=vercel-blob` for the same environments and redeploy.

For local work against the store, add the same two variables and `PHOTO_STORAGE=vercel-blob` to `apps/nextjs/.env.local`; otherwise local development keeps `PHOTO_STORAGE=local`.

## Checks

```bash
pnpm storage:check
```

With `PHOTO_STORAGE=vercel-blob` this writes and reads probe images, confirms nothing is overwritten, tests a signed upload and a signed download, confirms an unsigned address is refused, and deletes everything it wrote. `pnpm --filter @southview/services list-blob` counts the files in the store by folder.

## Moving photos between stores

`.southview/seed-batch-2/copy-photos-to-blob.mts` (kept outside the repository with the other operator scripts) copied the 16 stored files from R2 to Blob under the same keys and verified each one byte for byte. It never deletes from the source.

## Sources

- [Vercel Blob private storage](https://vercel.com/docs/vercel-blob/private-storage)
- [Signed URLs](https://vercel.com/docs/vercel-blob/vercel-signed-urls)
- [Private Blob general availability](https://vercel.com/changelog/vercel-private-blob-is-now-generally-available)
