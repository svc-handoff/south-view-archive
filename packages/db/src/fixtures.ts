import { validateArchive, type ArchiveData } from '@southview/validators';

const accessedAt = '2026-10-03';
const graveDatasetUrl =
  'https://github.com/southviewgravenavigation-coder/South-View-Grave-Navigation/blob/1deeef3240cad195c61959dbb52a7c583e84d9f3/data/graves.json';

/** Small, cited editorial collection. Coordinates are always [longitude, latitude]. */
export const fixtureArchive: ArchiveData = validateArchive({
  people: [
    {
      id: 'john-lewis',
      name: 'John Lewis',
      aliases: ['John Robert Lewis', 'John R. Lewis', 'Congressman John Lewis'],
      birthYear: 1940,
      deathYear: 2020,
      themes: ['Civil Rights', 'Civic Life'],
      summary:
        'A civil rights organizer who carried the work of nonviolent protest into Atlanta civic life and the United States Congress.',
      summaryCitations: [
        { sourceId: 'house-lewis-biography', locator: 'Biography: life dates and public service' },
      ],
      biography: [
        {
          text: 'Lewis chaired the Student Nonviolent Coordinating Committee from 1963 to 1966. He later served on the Atlanta City Council from 1982 to 1986 and in the U.S. House of Representatives from 1987 until his death in 2020.',
          citations: [{ sourceId: 'house-lewis-biography', locator: 'Biography' }],
        },
        {
          text: 'Lewis was born in Troy, Alabama, in 1940. His decades of public service ended with his death in Atlanta in 2020. He is buried at South-View Cemetery.',
          citations: [
            {
              sourceId: 'house-lewis-biography',
              locator: 'Biography: birth, death, and interment',
            },
          ],
        },
      ],
      portrait: {
        url: '/images/john-lewis.jpg',
        alt: 'Official congressional portrait of John Lewis in a dark suit and blue tie.',
        credit: 'U.S. Congress / Wikimedia Commons · Public domain',
        sourceId: 'commons-john-lewis-portrait',
      },
    },
    {
      id: 'martin-luther-king-sr',
      name: 'Martin Luther King Sr.',
      aliases: ['Daddy King', 'Michael King', 'Martin Luther King, Sr.'],
      deathYear: 1984,
      themes: ['Civil Rights', 'Faith & Community'],
      summary:
        'An Ebenezer Baptist Church pastor whose ministry also supported voting rights and educational equality in Atlanta.',
      summaryCitations: [
        {
          sourceId: 'stanford-king-sr',
          locator: 'Pastoral leadership, civic activism, and death in 1984',
        },
      ],
      biography: [
        {
          text: 'King succeeded A. D. Williams as pastor of Ebenezer in 1931. His Atlanta activism included a voter-registration campaign and efforts to challenge unequal pay for Black teachers.',
          citations: [
            { sourceId: 'stanford-king-sr', locator: 'Pastoral leadership and civic activism' },
          ],
        },
        {
          text: 'King died in Atlanta in 1984. He and Alberta Williams King are interred in a shared marble crypt at South-View Cemetery.',
          citations: [
            {
              sourceId: 'stanford-king-sr',
              locator: 'Final biographical paragraph: death in 1984',
            },
            { sourceId: 'explore-georgia-south-view', locator: 'Shared marble crypt' },
          ],
        },
      ],
    },
    {
      id: 'alonzo-herndon',
      name: 'Alonzo Herndon',
      aliases: ['Alonzo Franklin Herndon', 'Alonzo F. Herndon'],
      birthYear: 1858,
      deathYear: 1927,
      themes: ['Enterprise', 'Community Building'],
      summary:
        'An entrepreneur whose path from enslavement to barbering, property, and insurance helped shape Black business life in Atlanta.',
      summaryCitations: [
        {
          sourceId: 'herndon-home-museum',
          locator: 'Alonzo Herndon, 1858–1927; From Enslavement to Enterprise',
        },
      ],
      biography: [
        {
          text: 'Herndon developed successful Atlanta barbershops before expanding into insurance. In 1905, he acquired and combined businesses that became the foundation of Atlanta Life.',
          citations: [
            {
              sourceId: 'nps-herndon-nomination',
              locator: 'Printed pages 19–20: History of the Atlanta Life Insurance Company',
            },
          ],
        },
        {
          text: 'The Herndon Home preserves the history of his family and its place in the city. The National Park Service’s landmark documentation records his burial at South-View Cemetery.',
          citations: [
            { sourceId: 'herndon-home-museum' },
            { sourceId: 'nps-herndon-nomination', locator: 'Printed page 18: death and burial' },
          ],
        },
      ],
    },
  ],
  places: [
    {
      id: 'lewis-south-view',
      name: 'John Lewis',
      summary:
        'The grave of John Lewis at South-View Cemetery. The official congressional biography records his interment here; the marker is a reference position without a section or plot number.',
      summaryCitations: [
        {
          sourceId: 'house-lewis-biography',
          locator: 'Biography: interment at South-View Cemetery',
        },
      ],
      scope: 'cemetery',
      coordinates: [-84.3751025, 33.7027115],
      precision: 'reference',
      locationNote:
        'Burial at South-View is documented. This reference point has not been independently verified; no section or plot number is available.',
      coordinateCitations: [
        { sourceId: 'grave-navigation-data', locator: 'Record 2: lng and lat' },
      ],
    },
    {
      id: 'king-sr-south-view',
      name: 'King family crypt',
      summary:
        'The shared marble crypt of Martin Luther King Sr. and Alberta Williams King at South-View Cemetery, as recorded by Georgia’s official tourism guide.',
      summaryCitations: [{ sourceId: 'explore-georgia-south-view' }],
      scope: 'cemetery',
      coordinates: [-84.37371497174524, 33.70147934849705],
      precision: 'reference',
      locationNote:
        'The shared crypt is documented. Its position on this map is a reference point that has not been independently verified.',
      coordinateCitations: [
        { sourceId: 'grave-navigation-data', locator: 'Record 7: lng and lat' },
      ],
    },
    {
      id: 'herndon-south-view',
      name: 'Alonzo Herndon',
      summary:
        'The grave of Alonzo Herndon at South-View Cemetery. The Herndon Home National Historic Landmark nomination records his burial here; the marker is a reference position.',
      summaryCitations: [
        { sourceId: 'nps-herndon-nomination', locator: 'Printed page 18 / PDF page 18' },
      ],
      scope: 'cemetery',
      coordinates: [-84.371068, 33.70024],
      precision: 'reference',
      locationNote:
        'Burial at South-View is documented. This reference point has not been independently verified; no section or plot number is available.',
      coordinateCitations: [
        { sourceId: 'grave-navigation-data', locator: 'Record 14: lng and lat' },
      ],
    },
    {
      id: 'atlanta-city-hall',
      name: 'Atlanta City Hall',
      summary:
        'The seat of Atlanta’s city government at 55 Trinity Avenue SW. The archive marks the building as an institution; it does not identify any individual’s office or a visitor entrance.',
      summaryCitations: [{ sourceId: 'atlanta-government' }],
      scope: 'atlanta',
      coordinates: [-84.39058505, 33.7486207],
      precision: 'address',
      address: '55 Trinity Avenue SW, Atlanta, GA 30303',
      locationNote:
        'A building-level location marking Lewis’s connection to Atlanta city government. It does not identify his historical office or a visitor entrance.',
      coordinateCitations: [
        {
          sourceId: 'osm-atlanta-city-hall',
          locator: 'Way 113041909 v10; bounding-box midpoint from its full node geometry',
        },
        { sourceId: 'atlanta-government', locator: 'Atlanta City Hall address' },
      ],
    },
    {
      id: 'ebenezer-heritage',
      name: 'Ebenezer Baptist Church',
      summary:
        'The historic Heritage Sanctuary of Ebenezer Baptist Church on Auburn Avenue, preserved within the Martin Luther King, Jr. National Historical Park. Martin Luther King Sr. and Martin Luther King Jr. served the congregation as co-pastors.',
      summaryCitations: [{ sourceId: 'nps-ebenezer-place' }],
      scope: 'atlanta',
      coordinates: [-84.374046, 33.755268],
      precision: 'reference',
      address: 'Heritage Sanctuary, 407 Auburn Avenue NE, Atlanta, GA',
      locationNote:
        'An NPS visitor reference for the historic Heritage Sanctuary. Check visitor information for the appropriate entrance.',
      coordinateCitations: [
        {
          sourceId: 'nps-ebenezer-event',
          locator: 'Location: Latitude and Longitude 33.755268, -84.374046',
        },
        { sourceId: 'nps-ebenezer-place', locator: 'Quick Facts: 407 Auburn Avenue' },
      ],
    },
    {
      id: 'herndon-home',
      name: 'Herndon Home Museum',
      summary:
        'The Herndon family home on University Place, now a museum kept by The Herndon Foundation. It preserves the family’s history and the enterprises Alonzo Herndon built.',
      summaryCitations: [{ sourceId: 'herndon-home-museum', locator: 'History of the Home' }],
      scope: 'atlanta',
      coordinates: [-84.4067828, 33.7558062],
      precision: 'address',
      address: '587 University Place NW, Atlanta, GA 30314',
      locationNote:
        'A building-level museum location. Check the museum’s visitor information for entrance and access details.',
      coordinateCitations: [
        {
          sourceId: 'osm-herndon-home',
          locator: 'Node 367915546 v7; lat 33.7558062, lon -84.4067828',
        },
        { sourceId: 'herndon-home-museum', locator: 'Visitor Information: Location' },
      ],
    },
  ],
  relations: [
    {
      id: 'lewis-burial',
      personId: 'john-lewis',
      placeId: 'lewis-south-view',
      label: 'Remembered at South-View',
      description:
        'The official congressional biography records Lewis’s interment at South-View Cemetery.',
      citations: [
        {
          sourceId: 'house-lewis-biography',
          locator: 'Biography: interment at South-View Cemetery',
        },
      ],
    },
    {
      id: 'lewis-city-council',
      personId: 'john-lewis',
      placeId: 'atlanta-city-hall',
      label: 'Atlanta City Council · 1982–1986',
      description:
        'Lewis served on the Atlanta City Council before entering Congress. City Hall marks that institutional connection; the point does not identify his historical office.',
      citations: [
        { sourceId: 'house-lewis-biography', locator: 'Biography: city council, 1982–1986' },
        { sourceId: 'atlanta-government' },
      ],
    },
    {
      id: 'king-sr-burial',
      personId: 'martin-luther-king-sr',
      placeId: 'king-sr-south-view',
      label: 'Remembered at South-View',
      description:
        'Georgia’s official tourism guide records King and Alberta Williams King in a shared marble crypt at South-View.',
      citations: [{ sourceId: 'explore-georgia-south-view' }],
    },
    {
      id: 'king-sr-ebenezer',
      personId: 'martin-luther-king-sr',
      placeId: 'ebenezer-heritage',
      label: 'A ministry rooted in Atlanta',
      description:
        'King became Ebenezer’s pastor in 1931. NPS documents his later co-pastorate with Martin Luther King Jr. in the historic church.',
      citations: [{ sourceId: 'stanford-king-sr' }, { sourceId: 'nps-ebenezer-place' }],
    },
    {
      id: 'herndon-burial',
      personId: 'alonzo-herndon',
      placeId: 'herndon-south-view',
      label: 'Remembered at South-View',
      description:
        'The Herndon Home National Historic Landmark nomination records his burial at South-View.',
      citations: [{ sourceId: 'nps-herndon-nomination', locator: 'Printed page 18 / PDF page 18' }],
    },
    {
      id: 'herndon-residence',
      personId: 'alonzo-herndon',
      placeId: 'herndon-home',
      label: 'Home, family, and enterprise',
      description:
        'The home preserves the Herndon family’s history. Adrienne McNeil Herndon designed it, with Alonzo acting as general contractor.',
      citations: [{ sourceId: 'herndon-home-museum', locator: 'History of the Home' }],
    },
  ],
  materials: [
    {
      id: 'lewis-oral-history',
      personId: 'john-lewis',
      title: 'Remembering Selma',
      kind: 'oral-history',
      description:
        'Lewis recalls the Selma march and reflects on its continuing place in public life. The House archive offers audio excerpts and an edited transcript. Open the original archive to listen.',
      sourceId: 'house-lewis-oral-history',
      narrator: 'John R. Lewis',
      interviewer: 'Matt Wasniewski and Jackie Burns',
      date: '2014-12-11',
    },
    {
      id: 'king-sr-oral-history',
      personId: 'martin-luther-king-sr',
      title: 'Education, politics, and a life in Atlanta',
      kind: 'oral-history',
      description:
        'The library catalogue describes King’s recollections of education, racism, and politics. Explore the original sound-recording record at the holding library.',
      sourceId: 'dlg-king-sr-oral-history',
      narrator: 'Martin Luther King Sr.',
      interviewer: 'David Roberts',
      date: '1973-06-28',
    },
    {
      id: 'herndon-landmark-document',
      personId: 'alonzo-herndon',
      title: 'The Herndon Home landmark record',
      kind: 'document',
      description:
        'Read the National Park Service’s historical account of the house, the Herndon family, and the growth of Atlanta Life.',
      sourceId: 'nps-herndon-nomination',
    },
  ],
  sources: [
    {
      id: 'house-lewis-biography',
      title: 'LEWIS, John R.',
      creator: 'Office of the Historian',
      publisher: 'U.S. House of Representatives',
      url: 'https://history.house.gov/People/Detail/16948',
      accessedAt,
      kind: 'document',
      note: 'Supports offices held, life dates, and interment at South-View. No grave coordinates.',
    },
    {
      id: 'house-lewis-oral-history',
      title: 'The Honorable John R. Lewis — Oral History',
      creator: 'Matt Wasniewski and Jackie Burns; interview with John R. Lewis',
      publisher: 'Office of the Historian, U.S. House of Representatives',
      url: 'https://history.house.gov/OralHistory/Detail?id=25769814267',
      accessedAt,
      date: '2014-12-11',
      kind: 'oral-history',
      catalogueId: '25769814267',
      note: 'Original archive with audio excerpts, transcript, and linked deed of gift. This demo links out and does not copy the recording.',
    },
    {
      id: 'house-lewis-transcript',
      title: 'The Honorable John R. Lewis Oral History Interview — Final Edited Transcript',
      creator: 'Office of the Historian',
      publisher: 'U.S. House of Representatives',
      url: 'https://history.house.gov/Oral-History/People/OHPeople-Transcripts/lewis-transcript/',
      accessedAt,
      date: '2014-12-11',
      kind: 'document',
      note: 'PDF page ii gives the archive’s preferred citation; interview begins on printed page 1.',
    },
    {
      id: 'stanford-king-sr',
      title: 'King, Martin Luther, Sr.',
      creator: 'The Martin Luther King, Jr. Research and Education Institute',
      publisher: 'Stanford University',
      url: 'https://kinginstitute.stanford.edu/king-martin-luther-sr',
      accessedAt,
      kind: 'document',
      note: 'Lists birth as 19 December 1897, conflicting with the Smithsonian authority metadata and prior demo. Birth year is withheld in this collection.',
    },
    {
      id: 'smithsonian-king-sr-metadata',
      title: 'Lonnie C. King Oral History Interview',
      creator: 'Civil Rights History Project',
      publisher: 'National Museum of African American History and Culture, Smithsonian Institution',
      url: 'https://nmaahc.si.edu/object/nmaahc_2011.174.90.1a-k',
      accessedAt,
      date: '2013-05-29',
      kind: 'oral-history',
      catalogueId: '2011.174.90.1a-k',
      note: 'Subject metadata lists Martin Luther King Sr. as 1899–1984. The narrator is Lonnie C. King, NOT Martin Luther King Sr.; used here only to document a date conflict.',
    },
    {
      id: 'dlg-king-sr-oral-history',
      title: 'Martin Luther King Sr., June 28, 1973',
      creator: 'David Roberts; interview with Martin Luther King Sr.',
      publisher:
        'Atlanta University Center Robert W. Woodruff Library / Digital Library of Georgia',
      url: 'https://dlg.usg.edu/record/auu_drohc_auc-053-0002',
      accessedAt,
      date: '1973-06-28',
      kind: 'oral-history',
      catalogueId: 'auc.053:0002',
      note: 'David Roberts Oral History Collection. Catalogue specifies sound, audio/mpeg. Original partner player did not load during review; only the catalogue description is summarized.',
    },
    {
      id: 'explore-georgia-south-view',
      title: 'South-View Cemetery',
      creator: 'Explore Georgia',
      publisher: 'Georgia Department of Economic Development',
      url: 'https://exploregeorgia.org/atlanta/history-heritage/african-american/south-view-cemetery',
      accessedAt,
      kind: 'document',
      note: 'Documents the shared crypt of Martin Luther King Sr. and Alberta Williams King. Does not supply its coordinates.',
    },
    {
      id: 'nps-herndon-nomination',
      title: 'Herndon Home — National Historic Landmark Nomination',
      creator: 'National Historic Landmark documentation',
      publisher: 'National Park Service, U.S. Department of the Interior',
      url: 'https://npgallery.nps.gov/GetAsset/NHLS/00000261_text',
      accessedAt,
      kind: 'document',
      catalogueId: 'NRIS 00000261',
      note: 'Burial: printed page 18 (PDF page 18). Insurance history: pages 19–20. This fixture does not derive grave coordinates from the report.',
    },
    {
      id: 'herndon-home-museum',
      title: 'The Herndon Home Museum',
      creator: 'The Herndon Foundation',
      publisher: 'Herndon Home Museum',
      url: 'https://www.herndon.foundation/',
      accessedAt,
      kind: 'document',
      note: 'Supports the family home, enterprise overview, and address at 587 University Place NW. Text is paraphrased, not reproduced.',
    },
    {
      id: 'grave-navigation-data',
      title: 'South-View Grave Navigation — public graves dataset',
      creator: 'South-View Grave Navigation project contributors',
      publisher: 'GitHub / southviewgravenavigation-coder',
      url: graveDatasetUrl,
      accessedAt,
      kind: 'dataset',
      note: 'Public demo subset, records 2, 7, and 14. Coordinates have not been independently verified. The separate coordinates.json is inconsistent and is not used. Repository has no explicit license.',
    },
    {
      id: 'svcmap-seed',
      title: 'SVCMAP — seed entities',
      creator: 'SVCMAP project contributors',
      publisher: 'GitHub / taologan',
      url: 'https://github.com/taologan/SVCMAP/blob/82c3bb14c7d01311dbe93201dd8549db0824c522/scripts/seed-entities.mjs',
      accessedAt,
      kind: 'dataset',
      note: 'Reference for project crosswalk only. Explicit MOCK_ENTITIES are not treated as verified biographies or grave positions. No code or biography is copied from this file.',
    },
    {
      id: 'commons-john-lewis-portrait',
      title: 'File:Johnlewis.jpg — official congressional portrait',
      creator: 'Online Guide to House Members and Senators / U.S. Congress',
      publisher: 'Wikimedia Commons',
      url: 'https://commons.wikimedia.org/wiki/File:Johnlewis.jpg',
      accessedAt,
      date: '2011-07-07',
      kind: 'image',
      rights: 'Public domain in the United States; PD-US-Congress designation on the file page.',
      note: 'Original 675 × 825 JPEG, unchanged. SHA-1 ee850b66757798198376832126b3f4f7c6d0be88. Local file: /images/john-lewis.jpg.',
    },
    {
      id: 'osm-herndon-home',
      title: 'OpenStreetMap node 367915546 — Herndon Home Museum',
      creator: 'OpenStreetMap contributors',
      publisher: 'OpenStreetMap',
      url: 'https://www.openstreetmap.org/node/367915546',
      accessedAt,
      kind: 'dataset',
      catalogueId: 'node/367915546, version 7',
      rights: '© OpenStreetMap contributors, Open Database License (ODbL) 1.0.',
      note: 'Read from https://api.openstreetmap.org/api/0.6/node/367915546.json. Address-level point; no entrance precision claimed.',
    },
    {
      id: 'osm-atlanta-city-hall',
      title: 'OpenStreetMap way 113041909 — Atlanta City Hall',
      creator: 'OpenStreetMap contributors',
      publisher: 'OpenStreetMap',
      url: 'https://www.openstreetmap.org/way/113041909',
      accessedAt,
      kind: 'dataset',
      catalogueId: 'way/113041909, version 10',
      rights: '© OpenStreetMap contributors, Open Database License (ODbL) 1.0.',
      note: 'Read full node geometry from https://api.openstreetmap.org/api/0.6/way/113041909/full.json. Marker is its bounding-box midpoint, not an entrance.',
    },
    {
      id: 'atlanta-government',
      title: 'Government — City of Atlanta',
      creator: 'City of Atlanta',
      publisher: 'City of Atlanta',
      url: 'https://www.atlantaga.gov/government',
      accessedAt,
      kind: 'document',
      note: 'Confirms the current City Hall address at 55 Trinity Avenue SW. Does not identify Lewis’s historical office.',
    },
    {
      id: 'nps-ebenezer-place',
      title: 'Ebenezer — Heritage Sanctuary',
      creator: 'Martin Luther King, Jr. National Historical Park',
      publisher: 'National Park Service',
      url: 'https://www.nps.gov/places/ebenezer-heritage-sanctuary.htm',
      accessedAt,
      kind: 'document',
      note: 'Confirms historic church identity, street address, and the father-and-son co-pastorate.',
    },
    {
      id: 'nps-ebenezer-event',
      title: 'Church Talk — Historic Ebenezer Baptist Church',
      creator: 'Martin Luther King, Jr. National Historical Park',
      publisher: 'National Park Service',
      url: 'https://www.nps.gov/planyourvisit/event-details.htm?id=A5A53CC9-FB02-2589-A1D666D80B1F99E3',
      accessedAt,
      kind: 'document',
      note: 'Location section publishes 33.755268, -84.374046. Used as a visitor-location reference, not an entrance survey or a promise of current tour availability.',
    },
  ],
  issues: [
    {
      personId: 'martin-luther-king-sr',
      field: 'birthYear',
      note: 'Stanford gives 19 December 1897; Smithsonian subject metadata and the prior demo give 1899. This discrepancy is unresolved. Birth year, full birth date, and age are not displayed.',
      sourceIds: ['stanford-king-sr', 'smithsonian-king-sr-metadata', 'grave-navigation-data'],
    },
    {
      personId: 'john-lewis',
      field: 'burialCoordinates',
      note: 'Burial at South-View is documented independently, but the inherited latitude/longitude has no independent coordinate provenance or plot number.',
      sourceIds: ['house-lewis-biography', 'grave-navigation-data'],
    },
    {
      personId: 'martin-luther-king-sr',
      field: 'burialCoordinates',
      note: 'A shared crypt is documented; the inherited point is a reference only. No independent location measurement or section/plot identifier was found.',
      sourceIds: ['explore-georgia-south-view', 'grave-navigation-data'],
    },
    {
      personId: 'martin-luther-king-sr',
      field: 'oralHistoryAccess',
      note: 'The original library catalogue identifies a sound recording. The partner player did not load during review; audio playback and a complete transcript have not been independently verified.',
      sourceIds: ['dlg-king-sr-oral-history'],
    },
    {
      personId: 'alonzo-herndon',
      field: 'burialCoordinates',
      note: 'Burial is documented by NPS, but the inherited point is not independently verified. The separate coordinates.json associates ID 14 with a different person’s point and must not be joined to this record.',
      sourceIds: ['nps-herndon-nomination', 'grave-navigation-data'],
    },
  ],
  crosswalk: [
    {
      project: 'South-View Grave Navigation',
      externalId: '2',
      personId: 'john-lewis',
      note: 'John Robert Lewis; manually matched to the congressional biography.',
    },
    {
      project: 'South-View Grave Navigation',
      externalId: '7',
      personId: 'martin-luther-king-sr',
      note: 'Individual King Sr. record; birth year withheld pending conflict resolution.',
    },
    {
      project: 'South-View Grave Navigation',
      externalId: '14',
      personId: 'alonzo-herndon',
      note: 'Alonzo Franklin Herndon; coordinates taken from graves.json itself.',
    },
    {
      project: 'SVCMAP seed',
      externalId: 'john-lewis',
      personId: 'john-lewis',
      note: 'Congressman John Lewis name variant. Seed coordinates and text are not imported.',
    },
    {
      project: 'SVCMAP seed',
      externalId: 'mlk-sr-and-alberta',
      personId: null,
      note: 'Combined couple story. Not merged into King Sr.’s individual identity; Alberta requires her own reviewed person record.',
    },
    {
      project: 'SVCMAP seed',
      externalId: 'john-wesley-dobbs',
      personId: null,
      note: 'John Wesley Dobbs and Family is a group story outside this initial collection; no individual identity merge.',
    },
    {
      project: 'SVCMAP seed',
      externalId: 'adrienne-herndon',
      personId: null,
      note: 'Adrienne is a distinct person. Shared surname does not make this an Alonzo Herndon match.',
    },
  ],
});
