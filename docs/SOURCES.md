# Sources and editorial decisions

Reviewed 3 October 2026. This initial collection contains **3 people, 6 places, 6 person–place relationships, and 3 archival-material cards**. It is a small cited demonstration, not an index of all burials at South-View. The fixture is validated against the shared archive contract on import.

The machine-readable ledgers `data/sources.json` and `data/identity-crosswalk.json` are generated directly from the validated fixture, containing 17 source records and 7 identity mappings. They are plain JSON arrays, with no copied interview recordings or full source texts. Regenerate them whenever the fixture changes.

## Admission and citation rules

- Facts enter the collection only after the referenced page or document has been read. An earlier project’s citation string is a research lead, not independent evidence.
- Biographical text is a short editorial paraphrase. Each summary, biography paragraph, and relationship has source references. Direct quotations, invented memories, and synthetic historical voices are not used.
- Burial at a cemetery and the position of a particular grave are separate claims. A biography confirming burial does not verify a map coordinate.
- Coordinates use `[longitude, latitude]`. No point is labeled `verified` in this release. `address` means a building-level reference; `reference` means an inherited or published visitor point. Neither guarantees a usable entrance or walkable route.
- Conflicting facts remain recorded in `issues`. A disputed birth year is omitted instead of silently choosing one institution over another.
- An oral-history card names the actual narrator, interviewer, date, holding institution, and catalogue record. A biographical article or an interview mentioning someone is not represented as that person’s oral history.
- Sources and citations are distinct: `sources` stores bibliographic metadata; citations identify which source supports a claim, with a locator when useful. Media rights are recorded separately from the accuracy of a claim.

## People and supported claims

### John Lewis

[U.S. House of Representatives, “LEWIS, John R.”](https://history.house.gov/People/Detail/16948) supports his 1940–2020 life dates, SNCC chairmanship (1963–1966), Atlanta City Council service (1982–1986), congressional service (1987–2020), and interment at South-View. It supplies no grave coordinate.

The City Hall link is an **institutional civic connection**. The [City of Atlanta government page](https://www.atlantaga.gov/government) confirms the current address, 55 Trinity Avenue SW. The fixture does not claim to locate Lewis’s historical office, desk, council seat, or entrance.

### Martin Luther King Sr.

[Stanford’s King Institute biography](https://kinginstitute.stanford.edu/king-martin-luther-sr) supports his appointment at Ebenezer in 1931 and his voting-registration and teacher-pay activism. [NPS’s Heritage Sanctuary record](https://www.nps.gov/places/ebenezer-heritage-sanctuary.htm) identifies the historic church at 407 Auburn Avenue NE and the father-and-son co-pastorate.

[Explore Georgia’s South-View entry](https://exploregeorgia.org/atlanta/history-heritage/african-american/south-view-cemetery), published by Georgia’s tourism office, records the shared marble crypt of Martin Luther King Sr. and Alberta Williams King. This supports the shared-crypt relationship, not its coordinate.

**Unresolved birth-year conflict:** Stanford gives 19 December **1897**. The [Smithsonian NMAAHC catalogue for Lonnie C. King’s interview](https://nmaahc.si.edu/object/nmaahc_2011.174.90.1a-k) lists Martin Luther King Sr. as a subject with dates **1899–1984**. The earlier grave-navigation dataset also says 1899. The fixture omits King Sr.’s birth year and age and preserves both institutional references in `issues`. The Smithsonian narrator is **Lonnie C. King**, not Martin Luther King Sr.; that record is not attached as a King Sr. narration.

### Alonzo Herndon

The [Herndon Home Museum](https://www.herndon.foundation/) supports his 1858–1927 life dates, barbering and insurance career, family home, Adrienne’s role in designing the house, and the museum’s address at 587 University Place NW.

The [NPS Herndon Home National Historic Landmark nomination](https://npgallery.nps.gov/GetAsset/NHLS/00000261_text), NRIS 00000261, explicitly records his South-View burial on **printed page 18 / PDF page 18**. Printed pages 19–20 describe the 1905 insurance acquisition and combination. The fixture uses “became the foundation of Atlanta Life” to avoid suggesting that every later company name was already in use in 1905.

No independently checked grave measurement was found. No verified first-person Alonzo Herndon audio interview is included.

## Location evidence and reproducible methods

### Cemetery reference points

The source is the public [`data/graves.json`](https://github.com/southviewgravenavigation-coder/South-View-Grave-Navigation/blob/1deeef3240cad195c61959dbb52a7c583e84d9f3/data/graves.json), pinned to commit `1deeef3240cad195c61959dbb52a7c583e84d9f3`. Only the named records’ own `lat` and `lng` fields are used:

| Person                  | External ID |          Latitude |          Longitude | Status                          |
| ----------------------- | ----------: | ----------------: | -----------------: | ------------------------------- |
| John Robert Lewis       |           2 |        33.7027115 |        -84.3751025 | Inherited reference, unverified |
| Martin Luther King Sr.  |           7 | 33.70147934849705 | -84.37371497174524 | Inherited reference, unverified |
| Alonzo Franklin Herndon |          14 |          33.70024 |         -84.371068 | Inherited reference, unverified |

The repository calls the public data a demo subset. It has no explicit dataset license and no record-level coordinate provenance. A separate sanitizing script is capable of offsetting coordinates; its existence **does not prove these current named-person records were offset**. No such assumption is made.

**Do not join `data/coordinates.json` by ID.** It is inconsistent with `graves.json` after the first nine IDs: for example its ID 14 is the point attached to Annie McPheeters in `graves.json`, not Alonzo Herndon. The live predecessor reads `graves.json`; this fixture does the same. No section, lot, or space identifiers are asserted.

### Atlanta locations

| Place                                  | Evidence                                                                                                                                                                                  | Point and method                                                                                                                                                                  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Herndon Home Museum                    | [OSM node 367915546](https://www.openstreetmap.org/node/367915546), version 7; [official JSON API](https://api.openstreetmap.org/api/0.6/node/367915546.json); museum address above       | Lat 33.7558062, lon -84.4067828, directly from the named museum node. Building-level point.                                                                                       |
| Atlanta City Hall                      | [OSM way 113041909](https://www.openstreetmap.org/way/113041909), version 10; [full node geometry API](https://api.openstreetmap.org/api/0.6/way/113041909/full.json); city address above | Lat 33.7486207, lon -84.39058505. Computed as `((minLat + maxLat) / 2, (minLon + maxLon) / 2)` over the way’s nodes. This is the building bounding-box midpoint, not an entrance. |
| Historic Ebenezer / Heritage Sanctuary | [NPS Church Talk event record](https://www.nps.gov/planyourvisit/event-details.htm?id=A5A53CC9-FB02-2589-A1D666D80B1F99E3), Location section; historic-place record above                 | NPS publishes lat 33.755268, lon -84.374046 for the visitor event. Retained as a reference location; not a precise building survey.                                               |

The OSM coordinate data is credited to **© OpenStreetMap contributors**, under the [Open Database License](https://www.openstreetmap.org/copyright). A map baselayer’s attribution remains necessary independently of these source citations. The NPS event page is used only for its published location; the application does not promise current tour schedules.

## Oral-history and document cards

1. **John R. Lewis, interview of 11 December 2014.** Interviewed by Matt Wasniewski and Jackie Burns; Office of the Historian, U.S. House of Representatives. The [archive page](https://history.house.gov/OralHistory/Detail?id=25769814267) offers audio excerpts and the [complete edited transcript](https://history.house.gov/Oral-History/People/OHPeople-Transcripts/lewis-transcript/). The transcript’s page ii supplies citation information; its interview begins on printed page 1. The card paraphrases the archive’s scope and links to the original. It neither republishes the audio nor invents timestamped excerpts.
2. **Martin Luther King Sr., interview of 28 June 1973.** Interviewer David Roberts; David Roberts Oral History Collection; Atlanta University Center Robert W. Woodruff Library; catalogue `auc.053:0002`. The [DLG record](https://dlg.usg.edu/record/auu_drohc_auc-053-0002) explicitly describes sound in `audio/mpeg` format. The catalogue was accessible. The partner audio player did not load during this review, and no full transcript or in-app playback was verified. The source note and access issue preserve that limitation; the card summarizes only the catalogue description.
3. **Herndon Home landmark nomination.** A historical document, explicitly labeled `document`, not an oral-history recording. The NPS source is linked above.

External archive links are the intended behavior. Public access to a catalogue or player is not treated as blanket permission to rehost its media.

## Included image

Only one portrait is bundled:

- File: `apps/nextjs/public/images/john-lewis.jpg`; public URL `/images/john-lewis.jpg`.
- [Wikimedia Commons file record](https://commons.wikimedia.org/wiki/File:Johnlewis.jpg): official congressional portrait; source/author “Online Guide to House Members and Senators”; file date 7 July 2011.
- Rights: Commons marks this file **PD-US-Congress / public domain in the United States**. Credit shown in the interface: “U.S. Congress / Wikimedia Commons · Public domain”.
- [Original JPEG](https://upload.wikimedia.org/wikipedia/commons/b/bc/Johnlewis.jpg) downloaded without alteration: 675 × 825 pixels, 402,494 bytes. SHA-1 `ee850b66757798198376832126b3f4f7c6d0be88` matches the Commons record.
- No portrait was fabricated for King Sr. or Herndon. No old project logo or unverified photograph is bundled.

## Cross-project identity decisions

The [`SVCMAP` seed file](https://github.com/taologan/SVCMAP/blob/82c3bb14c7d01311dbe93201dd8549db0824c522/scripts/seed-entities.mjs) is used only to record a manual crosswalk. Its `MOCK_ENTITIES` biographies and coordinates are not imported as historical evidence.

- `john-lewis` is manually matched to the canonical John Lewis person.
- `mlk-sr-and-alberta` remains **unmerged**, because it represents a couple. A relationship to the shared crypt does not collapse Alberta into her husband’s identity.
- `john-wesley-dobbs` remains **unmerged**, because the original label includes “and Family” and is outside this initial collection.
- `adrienne-herndon` remains **unmerged**; she is a distinct person from Alonzo.
- Grave-navigation IDs 2, 7, and 14 are namespaced to their source project. They are not stable global person IDs or tour sequence numbers.

The public live SVCMAP instance has more records than the checked-in seeds. No inaccessible Firebase database, private export, account, API credential, or personal submission has been accessed or copied. The fixture does not claim to reproduce those live records.

## Public-copy review

### Cemetery map overlay (2026-11-06)

- Source: Fulton County, Georgia [tax parcels](https://gismaps.fultoncountyga.gov/arcgispub/rest/services/OpenData/Tax_Parcels/MapServer) (open data, tax year 2027), retrieved 2026-11-06: the 20 parcels whose owner is the South View Cemetery Association, of which four form the grounds.
- Method: each parcel was tested on its own against the earlier OpenStreetMap cemetery and the dated land survey compiled by another class group. Four parcels lie 71–100% inside both (the two at 1990 Jonesboro Road and the two "Southern Railroad" parcels) and were merged into one outline of about 100.8 acres, closing internal road gaps. The other 16 lots lie wholly outside both and were left out: those across Jonesboro Road and on Browns Mill Road, Knox Drive and Merrilyn Drive, and 1884 Jonesboro Road.
- Purpose / precision: shaded cemetery area and return-to-cemetery framing. An ownership outline from public tax records, not a surveyed boundary; it does not establish any burial or validate grave points.
- Rights: public records of Fulton County; the map credits the county.

### Earlier cemetery map overlay (2026-10-07, replaced)

- Provider / author: OpenStreetMap contributors; compiled as **Initial archive compilation**, not attributed to a named community member.
- Source: [South-View Cemetery, way 34773826](https://www.openstreetmap.org/way/34773826), version 9, last edited 2025-06-11. Accessed 2026-10-07 through the [OSM map API](https://api.openstreetmap.org/api/0.6/map?bbox=-84.382,33.693,-84.364,33.709).
- Referenced material: the named `landuse=cemetery` way and its 27-node closed outline. The separate Federal Penitentiary Cemetery feature is excluded. Coordinates are kept in longitude/latitude order in `apps/nextjs/src/lib/cemetery-area.ts`.
- Purpose / precision: shaded reference area and return-to-cemetery framing. This mapped outline is not a surveyed property boundary, does not establish any burial, and does not validate the inherited grave points. No individual location coordinates were changed by the layout update.
- Rights: © OpenStreetMap contributors, ODbL 1.0. Visible map attribution and the “South-View area” source link accompany the overlay.

### Narrative text

Biographies describe people and history. Details about old demos, dataset joins, identity merges, and coordinate calculations live in source notes, `issues`, `crosswalk`, and this document. Location cards retain concise accuracy notes that help visitors interpret the map.

Every date shown in a person heading has a source included in that person’s summary or biography citations:

| Heading dates                     | Supporting source                                                       |
| --------------------------------- | ----------------------------------------------------------------------- |
| John Lewis, 1940–2020             | House biography: explicitly gives 21 February 1940 and 17 July 2020.    |
| Martin Luther King Sr., died 1984 | Stanford’s final biographical paragraph; unresolved birth year omitted. |
| Alonzo Herndon, 1858–1927         | Herndon Home Museum’s Alonzo family profile and biographical section.   |

The OSM API responses were actually retrieved, not inferred from a secondary map website. They identify the named museum and city-hall features, their node coordinates, versions, and ODbL license. Source entries credit “© OpenStreetMap contributors” and link to the original map elements; coordinate methods remain above.
