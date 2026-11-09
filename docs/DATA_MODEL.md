# Archive data and editorial rules

The public archive uses one validated domain model, defined in `packages/validators/src/index.ts`. The Next.js components consume the archive API; they do not import the predecessor’s JSON. Server-side pages and tRPC handlers share the same repository and validation contract.

## Domain records

| Record        | Purpose                                                                                                                                | Evidence and constraints                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `Person`      | A durable person ID, name, known aliases, optional life dates, themes, summary, biography blocks, and an optional attributed portrait. | Every summary and biography block has citations. Omitted dates remain omitted. A portrait carries its credit and source ID.              |
| `Place`       | A cemetery or Atlanta location, optional address, `[longitude, latitude]` coordinates or `null`, precision, and a location note.       | Coordinates require their own evidence. An unmapped place uses `null` coordinates and `precision: 'unmapped'`.                           |
| `PersonPlace` | A relationship between a person and a place, with a label and a factual description.                                                   | Each relationship has citations independent of the place’s position. One person can have many places; one place can have many people.    |
| `Material`    | A linked oral history or document held by a source institution.                                                                        | Stores its source ID, description, and narrator, interviewer, and date when known. External links are the default.                       |
| `Source`      | A document, oral history, dataset, or image with a durable ID.                                                                         | Title, creator, publisher, URL, and access date are required; date, catalogue ID, rights, and notes preserve additional context.         |
| `Issue`       | An unresolved editorial question about a person’s field.                                                                               | Keep the note and supporting source IDs; withhold the disputed factual value until reviewed. Relevant notes are visible on person pages. |
| `Crosswalk`   | A reviewed match between an earlier project’s external identifier and a current person ID.                                             | A `null` person ID records a deliberate non-match. Document why, especially for a household or family record.                            |

A `Citation` is `{ sourceId, locator? }`. Use `locator` for a PDF’s printed page or an interview segment, not a substitute source title. The complete archive source order drives citation numbers across the interface. Person pages show only their relevant sources while preserving the original source numbers, so the list can have intentional numbering gaps. Citation anchors use stable source IDs (`#source-[id]`).

## Place precision

- `reference`: inherited coordinates with a named data source and an explicit “not independently verified” note. These are reference markers, not surveyed graves.
- `address`: an approximate address or building position, with the location method and supporting source in the note.
- `verified`: a position established by specific, reviewed location evidence. Never assign this merely because a biography is well sourced.
- `unmapped`: the history can be documented, but a defensible position has not been supplied. The person and relationship remain readable.

GeoJSON coordinates always use **longitude first, latitude second**. The earlier person record’s own coordinate pair is the only eligible inherited coordinate input; do not join an independent coordinate array by index. Check both numeric bounds and the expected Atlanta area to catch a plausible but reversed pair. A building entrance is not evidence of a statue’s position, and a cemetery burial citation is not evidence of a particular plot.

## Data modes

`ARCHIVE_DATA_MODE=fixture` loads the checked local collection and requires no cloud credentials. `ARCHIVE_DATA_MODE=database` uses `DATABASE_URL` through the server-side Drizzle repository. Both return the same `ArchiveData` shape. An invalid mode or a database connection/query failure must fail visibly; never catch that failure and silently serve fixtures.

The database is PostgreSQL-compatible and intended for Supabase PostgreSQL. `MIGRATION_DATABASE_URL` can supply a separate direct connection for migrations and seeding; application reads use the runtime database URL. Database connection strings remain server-only. Authentication and write APIs are outside this public browsing edition; adding Better Auth later does not require changing public person IDs.

Run the versioned migration before loading seed data, using the commands documented in the root README. Treat the included seed collection as a reviewed starting edition, not as automatic precedence over future editorial work. Review the seeding operation before applying it to a database containing independent changes.

## Adding a supported record

1. Inspect the original evidence and create the source record, preserving its URL, title, institution, access date, and specific pages or recording details. The list of sources is not itself proof that every possible claim has been checked.
2. Assign a new, durable person ID. Review names, aliases, dates, and context before adding a crosswalk. Never auto-merge by a shared surname, old numeric ID, approximate name match, or the fact that a couple shares a grave reference.
3. Write concise factual paragraphs with claim-appropriate citations. If a date or claim conflicts, leave the disputed field unset and retain the issue with its sources.
4. Create any relevant places and relationships separately. Give the relationship historical evidence and give coordinates position evidence, a precision label, and a human-readable note.
5. Add genuine archive materials with their narrator and recording context when available. A person speaking in an interview differs from somebody recalling that person; identify the narrator accordingly. Oral testimony does not require unrelated written corroboration to qualify as oral testimony.
6. Add a portrait only after verifying the image identity and use conditions; retain the creator and rights source. Leave it absent otherwise. Do not fabricate historical quotations, family memories, or community submissions.
7. Validate all references, review the public record at desktop and mobile widths, and check each source link. Test missing dates, no media, an unmapped relationship, and any unresolved note.

## Validation and public interfaces

`validateArchive` validates the schema, unique IDs, citation references, portrait source references, relationships, materials, issues, crosswalks, and coordinate/precision consistency. Public search, person detail, and map feature queries use the same repository. `createCaller({}).archive.snapshot()` supplies the complete validated public edition for the SSR archive page and exploration shell.

Search matches names, aliases, summaries, themes, and associated place names/addresses. Scope controls the visible relationship and place set; it does not delete a person with no location in that scope. The UI can therefore preserve a selected person while explaining that their cemetery or Atlanta position has not been documented.

An unrecognized person ID returns a 404. A record page remains readable without coordinates or photographs. Full person URLs are `/people/[id]`; all external archival material remains linked at its holding institution until playback and reproduction conditions have been verified.
