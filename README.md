# South-View Archive

A public archive of the people remembered at South-View Cemetery and the places across Atlanta connected to their lives. Visitors explore a map, read cited person and place pages, and contribute memories, corrections and photographs. Staff review every contribution before it is published and can correct the archive directly.

**Live site:** <https://south-view-archive.vercel.app/explore>

## What it does

- **Map** (`/explore`): South-View and Atlanta on one map, with search, theme filters and a people list. Selecting a marker opens a side panel (a bottom sheet on phones) with the person's places and directions in Google Maps. Both side panels can be dragged wider.
- **Person and place pages** (`/people/[id]`, `/places/[id]`): stories with citations, occupations and themes as tags, connected places, records and oral histories (linked to the collections holding them), notes on uncertain facts, and published contributions.
- **Contributions**: on a person's page, _Edit this page_ adds a paragraph, a correction, a place or a photograph where it belongs. `/contribute` is for a person not yet in the archive. Guests need no account: they keep a private receipt link that shows the review decision. The site sends no email.
- **Archive admin** (`/admin/contributions`, `/admin/people`, `/admin/places`), for reviewers:
  - review, publish, reject or withdraw contributions
  - correct any person, place, story, record, note or published contribution directly
  - delete and restore people and places

  Every direct change needs a reason, is listed in the record's change history, and can be undone.

- **AI check** (optional): staff can ask a model with web search to check a submission's claims. Its report is advisory and private; only staff publish.

Photographs are private by default. Originals, which can carry location data, are never shown; only approved copies with that data removed are public, and withdrawing a contribution hides them again.

## Run it locally

Requires **Node.js 22.21+** and **pnpm 11.19**. From the repository root:

```bash
pnpm install --frozen-lockfile
cp .env.example apps/nextjs/.env.local
pnpm dev
```

On Windows PowerShell use `Copy-Item .env.example apps/nextjs/.env.local`. Then open <http://127.0.0.1:3000/explore>.

The default local mode needs no accounts or keys:

- It creates a database under `.southview/` (ignored by Git), applies the migrations, and loads the starting archive once.
- Restarting keeps everything you added.
- Photos and the local sign-in secret are stored in the same folder.
- The basemap needs an internet connection.

| Command                     | What it does                                                              |
| --------------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`                  | Development server                                                        |
| `pnpm test`                 | All tests, on isolated temporary databases; nothing external is contacted |
| `pnpm typecheck`            | Type checks for every workspace                                           |
| `pnpm check`                | Type checks, tests and a production build                                 |
| `pnpm build` / `pnpm start` | Production build and server                                               |
| `pnpm format`               | Format the code with Prettier                                             |

## Configuration

`.env.example` lists every setting with comments. Two places read settings:

| Used by                                                                         | File                                                                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| The website (`pnpm dev`, `build`, `start`)                                      | `apps/nextjs/.env.local`, or the hosting platform's environment variables |
| Command-line tools (`db:migrate`, `db:seed`, `reviewer:grant`, `storage:check`) | Root `.env.local` or `.env`                                               |

The main settings:

| Setting                                                         | Meaning                                                                                                   |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ARCHIVE_DATA_MODE`                                             | `local` (default), `fixture` (read-only sample data), or `database` (PostgreSQL via `DATABASE_URL`)       |
| `PHOTO_STORAGE`                                                 | `local`, `vercel-blob` (deployed), `s3` (Cloudflare R2 or other S3-compatible), or `supabase`             |
| `DATABASE_URL`, `MIGRATION_DATABASE_URL`                        | Database connections for the website and for migrations                                                   |
| `BLOB_READ_WRITE_TOKEN` / `BLOB_STORE_ID`                       | The private Vercel Blob store, added when the store is connected to the project                           |
| `NEXT_PUBLIC_SITE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` | The site's public address and sign-in settings                                                            |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                      | Google sign-in (optional; guests can always contribute)                                                   |
| `OPENAI_API_KEY`                                                | Enables the AI check                                                                                      |
| `NEXT_PUBLIC_MAP_STYLE_URL`, `NEXT_PUBLIC_MAP_FONT`             | Basemap style and label font                                                                              |
| `TRUST_PROXY`                                                   | Set to `1` behind a proxy that sets the visitor's address (Vercel does), so rate limits apply per visitor |

Settings starting with `NEXT_PUBLIC_` are built into the browser code: never put secrets in them, and rebuild after changing them.

## Giving someone reviewer access

The person first signs in on the site with Google. Then, with the root `.env.local` pointing at the same database as the site (stop a local dev server first):

```bash
pnpm reviewer:grant --email reviewer@example.org --confirm
```

Add `--revoke` to remove access, and `--allow-production` when `NODE_ENV=production`. Signing in alone never grants reviewer access.

## Production

The live site runs on **Vercel**, with a **Supabase PostgreSQL** database created through the Vercel Marketplace and photos in a **private Vercel Blob store**.

1. Set `ARCHIVE_DATA_MODE=database`, the database URLs, `PHOTO_STORAGE=vercel-blob` and the sign-in settings in Vercel, and connect the Blob store to the project.
2. Apply migrations and seed the starting archive from a machine with the root `.env` pointing at the database:

   ```bash
   pnpm db:migrate
   pnpm db:seed --confirm
   ```

   Migrations run in order and refuse an edited migration that has already been applied. Seeding only adds missing records and never overwrites edits; add `--allow-production` when `NODE_ENV=production`.

3. Deploy with `apps/nextjs` as the application directory and `pnpm build` as the build command; it also prepares the map's worker files, which a bare `next build` skips. Then run `pnpm storage:check` to confirm the photo store accepts signed uploads and downloads and refuses unsigned reads.

Details: [Vercel deployment](docs/VERCEL.md), [Vercel Blob photo storage](docs/VERCEL-BLOB-STORAGE.md), [Cloudflare R2 storage](docs/R2-STORAGE.md), [Google sign-in](docs/GOOGLE-AUTH.md), [AI check](docs/AI-VETTING.md), [embedding the map in another site](docs/EMBEDDING.md).

## How the code is organised

| Folder                | Contents                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `apps/nextjs`         | Pages, the map, contribution forms, the Archive admin, and the HTTP API (`/api/community`, `/api/trpc`, `/api/auth`)    |
| `packages/validators` | Record and form rules shared by the website and the server                                                              |
| `packages/db`         | Data modes, migrations (`packages/db/migrations`), contributions and review, and staff corrections (`src/staff-edits/`) |
| `packages/services`   | Sign-in, photo processing and storage, upload links, and the AI check                                                   |
| `packages/api`        | Public read-only archive queries                                                                                        |
| `tests`               | Automated tests                                                                                                         |

Map coordinates are always stored **longitude first**.

## Privacy rules the code keeps

- Contributors' names and emails are stored apart from what is published, and never appear publicly.
- A private receipt link carries its secret after `#`, so it is never sent to the server in the address; only a hash is stored.
- Personal memories stay attributed to their contributor and do not become archive facts on their own.
- A shared surname never merges two people automatically.

## More documentation

- [Sources and editorial decisions](docs/SOURCES.md)
- [Data model and editorial rules](docs/DATA_MODEL.md)
- [Community data and review](docs/COMMUNITY-DATA.md)
- [Sign-in and photos](docs/COMMUNITY-SERVICES.md)
- [Validation record](docs/VALIDATION.md)

## Licence and credits

Code is under the [MIT licence](LICENSE). Historical photographs, sources and third-party data keep their own rights. See [third-party notices](THIRD_PARTY_NOTICES.md).

Built on [create-t3-turbo](https://github.com/t3-oss/create-t3-turbo), with [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/), [OpenFreeMap](https://openfreemap.org/), [Better Auth](https://better-auth.com/docs) and [Supabase](https://supabase.com/docs/guides/database/drizzle). Earlier South-View projects: [SVCMAP](https://github.com/taologan/SVCMAP) and [South-View Grave Navigation](https://github.com/southviewgravenavigation-coder/South-View-Grave-Navigation).
