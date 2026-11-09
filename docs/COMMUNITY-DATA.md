# Community submissions, persistence, and review

Community submissions are persisted to the database. Guests can contribute, use a private receipt to check status, and provide additional information; sign-in is optional. Public pages read only reviewed, published projections. Originals, contact details, unapproved photos, and internal review notes are excluded from public snapshots.

## Three data modes

| `ARCHIVE_DATA_MODE` | Behavior                                                                                                                          | Intended use                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `local` (default)   | Persists PostgreSQL data in local PGlite; applies versioned migrations and imports the initial collection once on first creation. | Local development and complete submission/review demonstrations.    |
| `fixture`           | Reads only the cited static initial collection; rejects submissions and all other community writes.                               | Read-only demonstrations and deterministic public-interface checks. |
| `database`          | Connects to the explicitly configured `DATABASE_URL`; does not automatically migrate, seed, or fall back to another mode.         | Deployed PostgreSQL / Supabase.                                     |

Connection failures, missing migrations, and incomplete public references produce errors rather than silently serving samples. Requests in `database` mode do not depend on the project directory or local database files. Connections require the standard Node runtime, not the Edge runtime.

The default private directory is `.southview/` at the project root. `SOUTHVIEW_DATA_DIR` changes the entire private-data root; PGlite defaults to its `db/` subdirectory, with `ARCHIVE_LOCAL_PATH` available to override just the database location. The service layer also stores local photos, development mail, and the development authentication secret under the private root. It is ignored by version control and must not be placed in `public/`, committed to Git, or served as static web content.

The file-backed database is intended for one Node service process. Hot reloads and requests within the same process share one connection-initialization Promise. A PID lock prevents different processes from opening the same directory concurrently. Locks left by exited processes can be recovered automatically, with a separate recovery mutex. Corrupt or incomplete locks cause opening to fail rather than risking mistaking an active process for a stale one. This is single-machine protection, not support for a network filesystem shared across hosts.

## Environment files, migrations, and seed data

Next reads `apps/nextjs/.env.local`. Database scripts read root `.env.local` and `.env`, with existing process variables taking precedence; they do not read the Next application's environment file. Both must use the same `ARCHIVE_DATA_MODE` and persistence directory.

Local mode initializes automatically when the application starts, so separate database commands are normally unnecessary. Stop the local development server before running database commands or the reviewer CLI, then restart it afterward to avoid two processes opening one PGlite directory.

```powershell
pnpm db:migrate
pnpm db:seed --confirm
```

`db:seed` requires explicit `--confirm`. Inserts use `ON CONFLICT DO NOTHING` and do not overwrite manual edits or later submissions. Local automatic initialization also records a one-time seed marker, preventing repeated imports on restart.

For cloud PostgreSQL, configure the root environment explicitly:

```dotenv
ARCHIVE_DATA_MODE=database
DATABASE_URL=postgresql://USER:PASSWORD@APPLICATION_HOST:PORT/postgres
MIGRATION_DATABASE_URL=postgresql://USER:PASSWORD@MIGRATION_HOST:PORT/postgres
```

The Supabase application connection can use a server-side pooler; named prepared statements are disabled. For migrations, separately set `MIGRATION_DATABASE_URL` to a direct connection or an appropriate session connection that supports migration transactions. Migration and seed scripts do not implicitly reuse the application's pooler URL. Run `pnpm db:migrate`, then `pnpm db:seed --confirm` when needed. With `NODE_ENV=production`, seeding also requires `--allow-production`, for example `pnpm db:seed --confirm --allow-production`.

Connection strings, storage secrets, and authentication secrets must not use `NEXT_PUBLIC_`. Running the project does not automatically provision cloud services. For the existing deployment's recorded resources, see [VERCEL.md](./VERCEL.md).

Migrations run in filename order inside transactions and save a checksum for each file. Never edit an applied migration; add a new file for subsequent changes:

| Migration            | Contents                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_archive.sql`   | Initial public people, places, relationships, materials, sources, and predecessor identity mappings.                                            |
| `0002_community.sql` | Public credit/contribution projections; private submissions, photos, supplements, reviews, publication revisions, mail events, and rate limits. |
| `0003_auth.sql`      | Optional Better Auth accounts, sessions, verification codes, and separate reviewer grants.                                                      |
| `0004_contacts.sql`  | Separate private contact table; migrates names/emails from existing submissions and removes those two fields from original-content JSON.        |

## Public and private records

The `archive` schema contains public projections: people, places, relationships, materials, sources, editorial issues, legacy identity mappings, `credits`, and published `contributions`. `getArchive()` reads only those designated tables in a consistent transaction snapshot. It does not join `community` or authentication tables.

The `community` schema stores the submission workflow:

| Table                   | Purpose                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `submissions`           | Original content, status, account ownership, receipt hash, timestamps, and public contribution ID.                    |
| `contacts`              | Private name and contact email, linked by submission ID.                                                              |
| `photos`                | Private original/processed object keys, original captions, creator, rights, and dimensions.                           |
| `supplements`           | Additional information appended by the contributor.                                                                   |
| `reviews`               | Decisions, contributor messages, public notes, and internal notes.                                                    |
| `publication_revisions` | Before/after versions of public entities changed by publication, with increasing sequence numbers for rollback order. |
| `mail_events`           | Legacy table from the removed email feature; no longer written.                                                       |
| `rate_limits`           | Atomic counters and expiry times, with hashed limit keys.                                                             |
| `reviewers`             | Reviewer authorization independent of ordinary account sign-in.                                                       |

Only after verifying an account, receipt, or reviewer privilege does the server merge `contacts` into the record needed by the contributor/reviewer interface. Contributors cannot see internal notes or reviewer account IDs. An ordinary account's submission list queries only its owned records; staff use a separate review-list interface.

Original authors, narrators, holding institutions, and providers are stored separately. Anonymous contributions display `Anonymous contributor`; a private name is never used as a fallback credit. Initial materials use `Initial archive compilation` and retain their institutional sources and image rights. New reviewed biography paragraphs carry their own credit and citations, without incorrectly assigning the new contributor as provider of an existing overview.

## Submissions, receipts, and sign-in

Sign-in uses configured Google OAuth, independently of guest submissions; the archive sends no email. Google requests only basic identity scopes. Existing accounts link only when local and Google emails match and both are verified; names and domains do not establish identity. The sign-in method never changes attribution choices, receipt requirements, or reviewer permissions. See [GOOGLE-AUTH.md](./GOOGLE-AUTH.md) for configuration and live-verification limits.

Submissions for an existing person are composed on that person's page: each in-page block is sent as its own submission with an advisory `placement` field (section, biography paragraph, proposed place name) that reviewers see but that changes no publication rule. Blocks sent together reuse one receipt token, so one private link opens all of them.

Before creating a submission, the browser generates a high-entropy receipt token and request ID. The database stores only the token's SHA-256 hash. A repeated creation request returns an existing draft only when request ID, token, and content all match. The token authorizes only this submission and cannot list other guest contributions.

Draft content can be edited and photos removed. After final submission, the original content and original photos are retained. Later information is appended as supplements rather than overwriting the original. Submissions move from draft to pending review; reviewers can request information, publish, or reject. Published content can be withdrawn. After an information request, the contributor can add photos and append a response, returning the submission to pending review.

A guest who later signs in can claim a submission only by presenting the original receipt and a verified email matching its contact. Matching names, an entered email string, or an ordinary session alone cannot establish ownership. A submission already owned by another account cannot be reclaimed.

No receipt or notification email is sent. The private receipt link returned after final submission is the contributor's only copy, and the receipt page tells them so; review decisions are read there.

## Review and publication

Reviewers must be granted server-side access through `community.reviewers`. First sign in on the website with a Google account with a verified email, then stop the local development server and run from the root:

```powershell
pnpm reviewer:grant --email reviewer@example.org --confirm
```

Restart the development server afterward. Add `--revoke` to revoke access; production also requires `--allow-production`. Ordinary sign-in never grants reviewer access automatically.

Publication is transactional: it creates public credit and an internal contribution source, records cited external links, creates the reviewed contribution and approved-photo list, applies biography/place changes only as explicitly selected by the reviewer, and stores revision records. Any failure rolls back the entire operation. Repeating an already completed publication creates no duplicate source, credit, revision, or contribution.

The review interface can edit public title, body, context, creator/narrator/institution, and photo captions, and choose which photos to publish. It can also change the person record itself (name, other names, birth and death years, themes, summary) through `personPatch`; only changed fields are sent, a changed summary cites the contribution, and the person's credits gain the contributor. Publishing with `applyTo: 'portrait'` makes the first approved photograph the person's portrait, served through the published entry, so withdrawal removes it again. Originals remain private. The server serves a processed image only after checking publication authorization; unapproved, rejected, or withdrawn images cannot be retrieved through public media IDs. Originals use a separate authenticated private endpoint.

New people require an explicit reviewer name and creation decision; similar names are never automatically merged. Personal memories remain attributed community records. The repository layer rejects applying `memory` directly as a biography fact or place update. Place changes require `[longitude, latitude]` order, coordinates in the Atlanta area, supporting citations, and a precision label consistent with whether coordinates exist.

Withdrawal removes the public contribution and its photo-access authorization, restores affected biography/place records in revision order, and removes sources/credits created by that publication only when no other public references depend on them. If a later review changed the same entity, or other public records still depend on the source, withdrawal returns an explicit conflict and rolls back. Reviewers must resolve dependencies first; the system never overwrites later work with an old version. Private originals, reviews, and revision history remain retained.

## Story search, multiple people, and event dates

`ContributionEntry` and `Material` retain their original `personId` and permanent URLs, with `relatedPersonIds`, `placeIds`, and `eventDate` added. Photos inherit their contribution's associations. Mentioned places do not automatically establish `PersonPlace` historical relationships or exact graves. Contributors can suggest links; reviewers confirm, replace, or clear them at publication, without changing the original submission. Dates support `unknown`, `year`, `approximate`, and `range`; publication dates are never used to guess event years.

These fields live in existing JSONB records and require no structural SQL migration. Validation supplies empty associations, unknown dates, and `featured: false` when reading older records, without rewriting existing migrations, originals, or review history. Withdrawal of newly created people/places checks dependencies from other public associations.

The public `archive.discover` interface accepts `q`, `type` (all/person/story/material/photo), `theme`, `personId`, `placeId`, `sort` (relevance/recent), `page`, and `featured`. It returns 12 results per page with record type, matching summary, permanent URL, credit/source/association IDs, category counts, and pagination. It searches only the public archive projection, never originals, contacts, unapproved attachments, or internal notes. Search covers stored text and source-catalogue metadata, not external audio, PDFs, or uncollected full text. An initial portrait appears in photo search only with a clear source and rights statement.

Reviewers set `featured` during publication; submission input does not accept it. Featured filters return only published selected stories. With an empty query and relevance sorting, featured items appear first. Nonempty queries still sort by match, while recent sorting uses public publication/material-source dates and places unknown dates last. Search currently runs against the server-side public snapshot; pagination limits browser data. A larger archive can adopt database full-text indexing without changing the public interface.

## Ongoing operations

The implementation provides a foundation for persisted contributions and human review. Before production operation, add regular backups and restore exercises, storage/mail monitoring, a contact retention/deletion policy, tools for resolving withdrawal dependencies, and retryable background mail jobs. Multi-instance deployments use `database` and private object storage, not shared local PGlite files.

See [SOURCES.md](./SOURCES.md) for evidence and initial citations, [DATA_MODEL.md](./DATA_MODEL.md) for archive entities and map precision, and [VALIDATION.md](./VALIDATION.md) for checks actually performed. Licensing and provenance are in [LICENSE](../LICENSE) and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
