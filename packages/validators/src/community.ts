import { z } from 'zod';

export const contributionKindSchema = z.enum(['memory', 'addition', 'correction', 'new-person']);
const eventYearSchema = z.number().int().min(1).max(9999);

const daysIn = (year: number, month: number) =>
  month === 2
    ? (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
      ? 29
      : 28
    : [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
/**
 * A birth or death date more precise than its year: a month (1897-12) or a day (1897-12-19).
 * Its year always equals the person's birth or death year, which lists and the map show.
 */
export const lifeDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}(-\d{2})?$/, 'Enter the date as a year, month and day.')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number?];
    if (year < 1 || month < 1 || month > 12) return false;
    return day === undefined || (day >= 1 && day <= daysIn(year, month));
  }, 'That day does not exist in that month.');
export const lifeDateYear = (date: string) => Number(date.slice(0, 4));
const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
export const monthName = (month: number) => monthNames[month - 1] ?? '';
/** "December 19, 1897", "December 1897" or "1897"; undefined when nothing is known. */
export function formatLifeDate(year: number | undefined, date?: string): string | undefined {
  if (date) {
    const [y, month, day] = date.split('-').map(Number) as [number, number, number?];
    return day ? `${monthName(month)} ${day}, ${y}` : `${monthName(month)} ${y}`;
  }
  return year ? String(year) : undefined;
}
/** Event time is independent of publication time; unknown dates remain explicitly unknown. */
export const eventDateSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('unknown') }),
    z.object({ kind: z.literal('year'), year: eventYearSchema }),
    z.object({ kind: z.literal('approximate'), year: eventYearSchema }),
    z.object({ kind: z.literal('range'), startYear: eventYearSchema, endYear: eventYearSchema }),
  ])
  .superRefine((date, ctx) => {
    if (date.kind === 'range' && date.startYear > date.endYear)
      ctx.addIssue({
        code: 'custom',
        path: ['endYear'],
        message: 'The end year must not precede the start year.',
      });
  });
export type EventDate = z.infer<typeof eventDateSchema>;
export function formatEventDate(date: EventDate | undefined): string {
  if (!date || date.kind === 'unknown') return 'Date unknown';
  if (date.kind === 'range') return `${date.startYear}–${date.endYear}`;
  return date.kind === 'approximate' ? `c. ${date.year}` : String(date.year);
}
export const linkedRecordIdsSchema = z
  .array(z.string().trim().min(1).max(120))
  .max(50)
  .transform((ids) => [...new Set(ids)]);
/** Where a contributor asked for an in-page addition to appear. Advisory for reviewers only. */
export const placementSchema = z.object({
  section: z.enum(['biography', 'places', 'community', 'portrait']),
  /** Biography block id (or index) the addition follows or the correction concerns. */
  blockId: z.string().trim().max(120).optional(),
  /** The paragraph text the contributor edited, so reviewers can compare and publication can match it. */
  originalText: z.string().trim().max(20000).optional(),
  proposedPlaceName: z.string().trim().max(160).optional(),
  /** A description of the place itself, offered alongside the person's connection to it. */
  proposedPlaceSummary: z.string().trim().max(4000).optional(),
  proposedScope: z.enum(['cemetery', 'atlanta']).optional(),
  /** A point the contributor marked on the map, longitude first. Reviewers confirm before publishing. */
  proposedCoordinates: z
    .tuple([z.number().min(-180).max(180), z.number().min(-85).max(85)])
    .optional(),
});
export type Placement = z.infer<typeof placementSchema>;
const webUrl = z
  .url({ error: 'Use a full web address, starting with http:// or https://.' })
  .refine(
    (value) => /^https?:\/\//i.test(value),
    'Use a full web address, starting with http:// or https://.',
  );
export const submissionInputSchema = z
  .object({
    clientRequestId: z.string().uuid(),
    kind: contributionKindSchema,
    personId: z.string().min(1).max(120).nullable(),
    relatedPersonIds: linkedRecordIdsSchema.default([]),
    placeIds: linkedRecordIdsSchema.default([]),
    eventDate: eventDateSchema.default({ kind: 'unknown' }),
    placement: placementSchema.optional(),
    proposedPersonName: z.string().trim().max(160).default(''),
    /** For a new person: what they did, as the contributor knows it. Reviewers decide the tags. */
    proposedOccupation: z.string().trim().max(160).default(''),
    title: z.string().trim().min(3, 'Give your story a title of at least 3 characters.').max(160),
    body: z.string().trim().min(20, 'Tell the story in at least 20 characters.').max(20000),
    context: z.string().trim().max(4000).default(''),
    sourceCreator: z.string().trim().max(200).default(''),
    narrator: z.string().trim().max(200).default(''),
    holdingInstitution: z.string().trim().max(200).default(''),
    links: z
      .array(z.object({ title: z.string().trim().min(1, 'Name the link.').max(200), url: webUrl }))
      .max(10, 'Add up to 10 links.')
      .default([]),
    privateName: z.string().trim().min(2, 'Enter your name.').max(160),
    email: z
      .email({ error: 'Enter a valid email address.' })
      .transform((value) => value.trim().toLowerCase()),
    anonymous: z.boolean(),
    displayName: z.string().trim().max(160).default(''),
    permission: z.literal(true),
  })
  .superRefine((input, ctx) => {
    if (!input.personId && !input.proposedPersonName)
      ctx.addIssue({
        code: 'custom',
        path: ['proposedPersonName'],
        message: 'Name the person this contribution concerns.',
      });
    if (!input.anonymous && !input.displayName)
      ctx.addIssue({
        code: 'custom',
        path: ['displayName'],
        message: 'Choose a public display name or contribute anonymously.',
      });
  })
  .transform((input) => ({
    ...input,
    relatedPersonIds: input.relatedPersonIds.filter((id) => id !== input.personId),
  }));
export const photoMetadataSchema = z.object({
  caption: z.string().trim().min(1).max(500),
  creator: z.string().trim().min(1).max(160),
  rights: z.string().trim().min(1).max(1000),
  permission: z.literal(true),
});
export const creditSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  kind: z.enum(['initial', 'community']),
  date: z.string().optional(),
});
export const publicPhotoSchema = photoMetadataSchema.omit({ permission: true }).extend({
  id: z.string(),
  url: z.string(),
  creditId: z.string(),
  width: z.number(),
  height: z.number(),
});
export const contributionEntrySchema = z
  .object({
    id: z.string(),
    featured: z.boolean().default(false),
    personId: z.string(),
    relatedPersonIds: linkedRecordIdsSchema.default([]),
    placeIds: linkedRecordIdsSchema.default([]),
    eventDate: eventDateSchema.default({ kind: 'unknown' }),
    kind: contributionKindSchema,
    title: z.string(),
    body: z.string(),
    context: z.string(),
    creditId: z.string(),
    sourceCreator: z.string().default(''),
    narrator: z.string().default(''),
    holdingInstitution: z.string().default(''),
    sourceIds: z.array(z.string()),
    photos: z.array(publicPhotoSchema),
    publishedAt: z.string(),
    updatedAt: z.string(),
    publicNote: z.string().optional(),
  })
  .transform((entry) => ({
    ...entry,
    relatedPersonIds: entry.relatedPersonIds.filter((id) => id !== entry.personId),
  }));
/** Edits to a person record's own fields. Omitted fields keep their current values. */
export const personPatchSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter the person’s public name, or leave it as it was.')
    .max(160)
    .optional(),
  aliases: z
    .array(z.string().trim().min(1, 'Remove the empty entry under other names.').max(160))
    .max(20)
    .optional(),
  birthYear: eventYearSchema.nullable().optional(),
  deathYear: eventYearSchema.nullable().optional(),
  /** A month or day refining the birth year; null clears it back to the year alone. */
  birthDate: lifeDateSchema.nullable().optional(),
  deathDate: lifeDateSchema.nullable().optional(),
  themes: z
    .array(z.string().trim().min(1, 'Remove the empty theme entry.').max(80))
    .max(20)
    .optional(),
  /** An empty list removes the occupations. */
  occupations: z
    .array(z.string().trim().min(1, 'Remove the empty occupation entry.').max(80))
    .max(10)
    .optional(),
  summary: z
    .string()
    .trim()
    .min(1, 'Enter a summary for the person, or leave it as it was.')
    .max(4000)
    .optional(),
});
type LifePatch = Pick<
  z.infer<typeof personPatchSchema>,
  'birthYear' | 'deathYear' | 'birthDate' | 'deathDate'
>;
/**
 * Applies year and full-date changes to a person record in place, keeping each full date's year
 * equal to its year: a date without a year supplies the year, a changed year drops a date it no
 * longer matches, and a cleared year clears its date. Returns a message when the dates conflict.
 */
export function applyLifeDates(record: Record<string, unknown>, patch: LifePatch): string | null {
  for (const [yearKey, dateKey, label] of [
    ['birthYear', 'birthDate', 'birth'],
    ['deathYear', 'deathDate', 'death'],
  ] as const) {
    const year = patch[yearKey];
    const date = patch[dateKey];
    if (year === null) delete record[yearKey];
    else if (year !== undefined) record[yearKey] = year;
    if (date === null) delete record[dateKey];
    else if (date !== undefined) record[dateKey] = date;
    const current = record[dateKey];
    if (typeof current !== 'string') continue;
    if (record[yearKey] === undefined) {
      if (year === null) delete record[dateKey];
      else record[yearKey] = lifeDateYear(current);
    } else if (record[yearKey] !== lifeDateYear(current)) {
      if (date === undefined) delete record[dateKey];
      else return `The full ${label} date must be in the ${label} year.`;
    }
  }
  const birth = record.birthYear;
  const death = record.deathYear;
  if (typeof birth === 'number' && typeof death === 'number') {
    if (birth > death) return 'The birth year must not be after the death year.';
    const born = record.birthDate;
    const died = record.deathDate;
    if (
      birth === death &&
      typeof born === 'string' &&
      typeof died === 'string' &&
      born.slice(0, Math.min(born.length, died.length)) >
        died.slice(0, Math.min(born.length, died.length))
    )
      return 'The birth date must not be after the death date.';
  }
  return null;
}
/** Why a staff member is changing a record directly; shown in the change history. */
export const staffReasonSchema = z
  .string()
  .trim()
  .min(3, 'Say briefly why you are making this change.')
  .max(1000);
export const staffPersonEditSchema = z.object({
  patch: personPatchSchema,
  reason: staffReasonSchema,
});
export type StaffPersonEdit = z.infer<typeof staffPersonEditSchema>;
/** One direct staff change to a public record, as listed in the archive admin's history. */
export type StaffEdit = {
  id: string;
  /** Rows changed by one staff action share a batch and are undone together. */
  batchId: string;
  targetTable:
    | 'persons'
    | 'places'
    | 'person_places'
    | 'materials'
    | 'sources'
    | 'issues'
    | 'contributions';
  targetId: string;
  reason: string;
  actorEmail: string | null;
  createdAt: string;
  /** Top-level fields whose value differs between the record before and after. */
  changedFields: string[];
  previous: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  /** Set on the entry that undid another entry. */
  undoOf: string | null;
  /** Set on an entry that has been undone. */
  undoneAt: string | null;
};
// The metropolitan-Atlanta bounds are checked where the place is saved, with a plain message.
const staffCoordinatesSchema = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .nullable();
/** Corrections to a map place's own fields. Omitted fields keep their current values. */
export const staffPlaceEditSchema = z.object({
  patch: z.object({
    name: z.string().trim().min(1, 'Name the place.').max(160).optional(),
    scope: z.enum(['cemetery', 'atlanta']).optional(),
    address: z.string().trim().max(300).nullable().optional(),
    coordinates: staffCoordinatesSchema.optional(),
    precision: z.enum(['reference', 'address', 'verified', 'unmapped']).optional(),
    locationNote: z
      .string()
      .trim()
      .min(1, 'Describe the location evidence and its limits.')
      .max(2000)
      .optional(),
    summary: z.string().trim().max(4000).optional(),
  }),
  reason: staffReasonSchema,
});
export type StaffPlaceEdit = z.infer<typeof staffPlaceEditSchema>;
/** Corrections to how one person is connected to one place. */
export const staffLinkEditSchema = z.object({
  patch: z.object({
    label: z.string().trim().min(1, 'Describe the relationship.').max(160).optional(),
    description: z.string().trim().max(4000).optional(),
  }),
  reason: staffReasonSchema,
});
export type StaffLinkEdit = z.infer<typeof staffLinkEditSchema>;
/** Connects a person to a place already on the map, citing one of the archive's sources. */
export const staffLinkCreateSchema = z.object({
  personId: z.string().min(1).max(120),
  placeId: z.string().min(1).max(120),
  label: z.string().trim().min(1, 'Describe the relationship.').max(160),
  description: z.string().trim().max(4000).default(''),
  sourceId: z.string().min(1, 'Choose the source that supports this connection.').max(200),
  reason: staffReasonSchema,
});
export type StaffLinkCreate = z.infer<typeof staffLinkCreateSchema>;
export const staffRemoveSchema = z.object({ reason: staffReasonSchema });
/**
 * A person's story as staff rewrote it: the paragraphs in their new order, each either an
 * existing one (by its position in `base`, the story as the editor loaded it) or a new one.
 * Paragraphs left out are removed.
 */
export const staffBiographySchema = z.object({
  base: z.array(z.unknown()).max(500),
  paragraphs: z
    .array(
      z.object({
        from: z.number().int().min(0).optional(),
        text: z
          .string()
          .trim()
          .min(1, 'A paragraph cannot be empty. Remove it instead.')
          .max(20000),
        citations: z
          .array(
            z.object({
              sourceId: z.string().min(1).max(200),
              locator: z.string().trim().max(200).optional(),
            }),
          )
          .min(1, 'Cite at least one source for each paragraph.')
          .max(20),
      }),
    )
    .max(500),
  reason: staffReasonSchema,
});
export type StaffBiography = z.infer<typeof staffBiographySchema>;
/** Corrections to a published contribution's public entry. Omitted fields stay as published. */
export const staffContributionEditSchema = z.object({
  patch: z.object({
    title: z
      .string()
      .trim()
      .min(3, 'Give the public title at least 3 characters.')
      .max(160)
      .optional(),
    body: z
      .string()
      .trim()
      .min(20, 'Keep at least 20 characters of public text.')
      .max(20000)
      .optional(),
    context: z.string().trim().max(4000).optional(),
    sourceCreator: z.string().trim().max(200).optional(),
    narrator: z.string().trim().max(200).optional(),
    holdingInstitution: z.string().trim().max(200).optional(),
    eventDate: eventDateSchema.optional(),
    featured: z.boolean().optional(),
    publicNote: z.string().trim().max(3000).optional(),
    relatedPersonIds: linkedRecordIdsSchema.optional(),
    placeIds: linkedRecordIdsSchema.optional(),
    photos: z
      .array(
        z.object({
          id: z.string().min(1).max(200),
          caption: z.string().trim().min(1, 'Give each photograph a caption.').max(500),
          creator: z.string().trim().min(1, 'Name the creator of each photograph.').max(160),
          rights: z.string().trim().min(1, 'State the rights for each photograph.').max(1000),
        }),
      )
      .max(10)
      .optional(),
  }),
  reason: staffReasonSchema,
});
export type StaffContributionEdit = z.infer<typeof staffContributionEditSchema>;
/** Where a record or oral history is held: a link to the collection, never an uploaded file. */
export const staffSourceLinkSchema = z.object({
  /** Blank uses the record's own title. */
  title: z.string().trim().max(300).default(''),
  creator: z.string().trim().max(200).default(''),
  publisher: z.string().trim().min(2, 'Say which library, archive or website holds it.').max(200),
  url: z
    .string()
    .trim()
    .max(2000)
    .refine(
      (value) => /^https?:\/\/[^\s]+\.[^\s]+/.test(value),
      'Paste the full web address, starting with https://.',
    ),
  rights: z.string().trim().max(500).default(''),
});
export type StaffSourceLink = z.infer<typeof staffSourceLinkSchema>;
/** A record or oral history shown on a person's page, linking out to the collection holding it. */
export const staffMaterialSchema = z.object({
  material: z.object({
    title: z.string().trim().min(3, 'Give the record a title of at least 3 characters.').max(300),
    kind: z.enum(['oral-history', 'document']),
    description: z.string().trim().min(10, 'Describe the record in a sentence or two.').max(4000),
    narrator: z.string().trim().max(200).default(''),
    interviewer: z.string().trim().max(200).default(''),
    /** When it was recorded or written, as the collection gives it. */
    date: z.string().trim().max(200).default(''),
    /** When the events it describes happened. */
    eventDate: eventDateSchema.default({ kind: 'unknown' }),
    relatedPersonIds: linkedRecordIdsSchema.default([]),
    placeIds: linkedRecordIdsSchema.default([]),
  }),
  /** An archive source already in use (optionally corrected), or a new link. */
  source: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('existing'),
      sourceId: z.string().min(1).max(200),
      link: staffSourceLinkSchema.optional(),
    }),
    z.object({ mode: z.literal('new'), link: staffSourceLinkSchema }),
  ]),
  reason: staffReasonSchema,
});
export type StaffMaterial = z.infer<typeof staffMaterialSchema>;
export const staffMaterialCreateSchema = staffMaterialSchema.extend({
  personId: z.string().min(1).max(120),
});
export type StaffMaterialCreate = z.infer<typeof staffMaterialCreateSchema>;
/** A public note on a person's record, such as sources disagreeing about a date. */
export const staffIssueSchema = z.object({
  /** What the note concerns: a field name such as birthYear, or "other". Not shown publicly. */
  field: z.string().trim().min(1).max(60),
  note: z.string().trim().min(10, 'Write the note in at least 10 characters.').max(4000),
  sourceIds: z
    .array(z.string().min(1).max(200))
    .max(20)
    .transform((ids) => [...new Set(ids)]),
  reason: staffReasonSchema,
});
export type StaffIssue = z.infer<typeof staffIssueSchema>;
export const staffIssueCreateSchema = staffIssueSchema.extend({
  personId: z.string().min(1).max(120),
});
export type StaffIssueCreate = z.infer<typeof staffIssueCreateSchema>;
export const reviewInputSchema = z
  .object({
    action: z.enum(['publish', 'needs-information', 'reject', 'withdraw']),
    featured: z.boolean().optional(),
    title: z
      .string()
      .trim()
      .min(3, 'Give the public title at least 3 characters.')
      .max(160)
      .optional(),
    body: z
      .string()
      .trim()
      .min(20, 'Keep at least 20 characters of public text.')
      .max(20000)
      .optional(),
    context: z.string().trim().max(4000).optional(),
    sourceCreator: z.string().trim().max(200).optional(),
    narrator: z.string().trim().max(200).optional(),
    holdingInstitution: z.string().trim().max(200).optional(),
    photoEdits: z
      .array(
        z.object({
          id: z.string(),
          caption: z.string().trim().min(1, 'Give each approved photograph a caption.').max(500),
          creator: z
            .string()
            .trim()
            .min(1, 'Name the creator of each approved photograph.')
            .max(160),
          rights: z
            .string()
            .trim()
            .min(1, 'State the rights for each approved photograph.')
            .max(1000),
        }),
      )
      .max(5)
      .optional(),
    personId: z
      .string()
      .min(1, 'Choose the person this contribution concerns.')
      .max(120)
      .nullable()
      .optional(),
    relatedPersonIds: linkedRecordIdsSchema.optional(),
    placeIds: linkedRecordIdsSchema.optional(),
    eventDate: eventDateSchema.optional(),
    newPersonName: z.string().trim().max(160).optional(),
    publicNote: z.string().trim().max(3000).default(''),
    authorMessage: z.string().trim().max(3000).default(''),
    internalNote: z.string().trim().max(5000).default(''),
    sourceIds: z.array(z.string()).max(20).default([]),
    approvedPhotoIds: z.array(z.string()).max(5).optional(),
    applyTo: z.enum(['entry', 'biography', 'place', 'portrait']).default('entry'),
    /** Reviewer edits to the person record itself. Omitted fields keep their current values. */
    personPatch: personPatchSchema.optional(),
    placePatch: z
      .object({
        placeId: z.string(),
        name: z.string().trim().min(1, 'Name the map place.'),
        scope: z.enum(['cemetery', 'atlanta']),
        coordinates: z
          .tuple([z.number().min(-180).max(180), z.number().min(-85).max(85)])
          .nullable(),
        precision: z.enum(['reference', 'address', 'verified', 'unmapped']),
        locationNote: z
          .string()
          .trim()
          .min(1, 'Describe the location evidence and its limits for the map place.'),
        relationship: z
          .string()
          .trim()
          .min(1, 'Describe the person’s relationship to the map place.'),
        /** Public description of the place itself; omitted keeps the current one. */
        summary: z.string().trim().max(4000).optional(),
      })
      .optional(),
  })
  .superRefine((review, ctx) => {
    if (['reject', 'needs-information'].includes(review.action) && !review.authorMessage.trim())
      ctx.addIssue({
        code: 'custom',
        path: ['authorMessage'],
        message: 'Include a clear message to the contributor explaining this decision.',
      });
  })
  .transform((review) => ({
    ...review,
    ...(review.relatedPersonIds === undefined
      ? {}
      : { relatedPersonIds: review.relatedPersonIds.filter((id) => id !== review.personId) }),
  }));
export type SubmissionInput = z.infer<typeof submissionInputSchema>;
export type PhotoMetadata = z.infer<typeof photoMetadataSchema>;
export type ContributionEntry = z.infer<typeof contributionEntrySchema>;
export type ContributionCredit = z.infer<typeof creditSchema>;
export type ReviewInput = z.infer<typeof reviewInputSchema>;
export type SubmissionStatus =
  | 'draft'
  | 'pending'
  | 'needs-information'
  | 'published'
  | 'rejected'
  | 'withdrawn';
export type Actor = {
  userId: string | null;
  email: string | null;
  reviewer: boolean;
  receiptToken?: string;
};
export type SubmissionPhoto = PhotoMetadata & {
  id: string;
  originalKey: string;
  publicKey: string;
  width: number;
  height: number;
  mimeType: string;
  bytes: number;
};
export type SubmissionRecord = {
  id: string;
  input: SubmissionInput;
  status: SubmissionStatus;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
  photos: SubmissionPhoto[];
  supplements: { id: string; body: string; createdAt: string }[];
  reviews: {
    action: string;
    authorMessage: string;
    publicNote: string;
    internalNote?: string;
    createdAt: string;
    reviewerId?: string;
  }[];
  publishedEntryId: string | null;
};
