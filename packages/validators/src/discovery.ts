import { z } from 'zod';
import type { ArchiveData, Person } from './index';
import type { ContributionEntry, EventDate } from './community';

export const DISCOVERY_PAGE_SIZE = 12;
export const discoveryInputSchema = z.object({
  q: z.string().trim().max(200).default(''),
  type: z.enum(['all', 'person', 'story', 'material', 'photo']).default('all'),
  theme: z.string().max(80).default('all'),
  personId: z.string().min(1).max(120).optional(),
  placeId: z.string().min(1).max(120).optional(),
  featured: z.boolean().default(false),
  sort: z.enum(['relevance', 'recent']).default('relevance'),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});
export type DiscoveryInput = z.infer<typeof discoveryInputSchema>;
export type DiscoveryType = Exclude<DiscoveryInput['type'], 'all'>;
export type DiscoveryPhoto = {
  url: string;
  alt: string;
  caption: string;
  creator: string;
  rights: string;
  width?: number;
  height?: number;
  sourceId?: string;
};
type DiscoveryBase = {
  /** Namespaced identity used for deduplication and rendering keys. */
  id: string;
  entityId: string;
  title: string;
  excerpt: string;
  url: string;
  personIds: string[];
  placeIds: string[];
  creditIds: string[];
  sourceIds: string[];
  themes: string[];
  /** Publication/material date, not an invented exact historical event date. */
  date?: string;
  eventDate?: EventDate;
};
export type DiscoveryResult = DiscoveryBase &
  (
    | { type: 'person'; portrait?: Person['portrait'] }
    | { type: 'story'; storyKind: ContributionEntry['kind']; featured: boolean }
    | { type: 'material'; materialKind: 'oral-history' | 'document'; sourceUrl: string }
    | { type: 'photo'; photo: DiscoveryPhoto }
  );
export type DiscoveryPage = {
  items: DiscoveryResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  /** Facet totals after text/theme/person/place/featured filters, before the type filter. */
  counts: Record<'all' | DiscoveryType, number>;
};

type RelatedPublicRecord = { personId: string; relatedPersonIds?: string[] };
export function publicRelatedPersonIds(record: RelatedPublicRecord): string[] {
  return [...new Set([record.personId, ...(record.relatedPersonIds ?? [])])];
}
const unique = (values: string[]) => [...new Set(values)];
const normalized = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const words = (text: string) => unique(normalized(text).trim().split(/\s+/u).filter(Boolean));

/** Excerpts are text only. Render them as text nodes, never as HTML. */
export function discoveryPlainText(input: string): string {
  return input
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity: string) => {
      const named: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
      };
      if (entity[0] !== '#') return named[entity.toLowerCase()] ?? whole;
      const code =
        entity[1]?.toLowerCase() === 'x'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isSafeInteger(code) &&
        code > 0 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : ' ';
    })
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}
function excerpt(fields: string[], query: string[]) {
  const readable = fields.map(discoveryPlainText).filter(Boolean);
  const selected = query.length
    ? [...readable].sort(
        (left, right) =>
          query.filter((word) => normalized(right).includes(word)).length -
          query.filter((word) => normalized(left).includes(word)).length,
      )[0]
    : readable[0];
  if (!selected) return '';
  if (selected.length <= 220) return selected;
  const firstMatch =
    query
      .map((word) => selected.toLowerCase().indexOf(word))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  let start = Math.max(0, firstMatch - 65);
  if (start > 0) {
    const nextSpace = selected.indexOf(' ', start);
    if (nextSpace >= 0 && nextSpace < firstMatch) start = nextSpace + 1;
  }
  const end = Math.min(selected.length, start + 220);
  return `${start ? '…' : ''}${selected.slice(start, end).trim()}${end < selected.length ? '…' : ''}`;
}

type IndexedResult = {
  result: DiscoveryResult;
  text: string;
  title: string;
  excerpts: string[];
  recent: number;
};
function publicationTime(date?: string) {
  if (!date || !/^\d{4}(?:-\d{2}(?:-\d{2}(?:T.*)?)?)?$/.test(date)) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(date);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/** Accepts only the public ArchiveData projection; never reads submissions or contacts. */
function discoveryIndex(data: ArchiveData): IndexedResult[] {
  const sources = new Map(data.sources.map((source) => [source.id, source]));
  const people = new Map(data.people.map((person) => [person.id, person]));
  const places = new Map(data.places.map((place) => [place.id, place]));
  const credits = new Map((data.credits ?? []).map((credit) => [credit.id, credit]));
  const results = new Map<string, IndexedResult>();
  const sourceText = (ids: string[]) =>
    ids.flatMap((id) => {
      const source = sources.get(id);
      return source
        ? [
            source.title,
            source.creator,
            source.publisher,
            source.url,
            source.date ?? '',
            source.catalogueId ?? '',
            source.rights ?? '',
            source.note ?? '',
          ]
        : [];
    });
  const linkedText = (personIds: string[], placeIds: string[], creditIds: string[]) => [
    ...personIds.flatMap((id) => {
      const person = people.get(id);
      return person
        ? [person.name, ...person.aliases, ...person.themes, ...(person.occupations ?? [])]
        : [];
    }),
    ...placeIds.flatMap((id) => {
      const place = places.get(id);
      return place ? [place.name, place.address ?? ''] : [];
    }),
    ...creditIds.map((id) => credits.get(id)?.displayName ?? ''),
  ];
  const themesFor = (ids: string[]) => unique(ids.flatMap((id) => people.get(id)?.themes ?? []));
  function add(result: DiscoveryResult, fields: string[], extra: string[] = []) {
    const clean = { ...result, title: discoveryPlainText(result.title) };
    const textFields = [
      ...fields,
      ...extra,
      ...linkedText(clean.personIds, clean.placeIds, clean.creditIds),
      ...sourceText(clean.sourceIds),
    ];
    if (!results.has(clean.id))
      results.set(clean.id, {
        result: clean,
        title: normalized(clean.title),
        text: normalized([clean.title, ...textFields].map(discoveryPlainText).join(' ')),
        excerpts: [...fields, ...extra, ...sourceText(clean.sourceIds)],
        recent: publicationTime(clean.date),
      });
  }
  for (const person of data.people) {
    const relations = data.relations.filter((relation) => relation.personId === person.id);
    const personIds = [person.id];
    const placeIds = unique(relations.map((relation) => relation.placeId));
    const sourceIds = unique([
      ...person.summaryCitations.map((citation) => citation.sourceId),
      ...person.biography.flatMap((paragraph) =>
        paragraph.citations.map((citation) => citation.sourceId),
      ),
    ]);
    add(
      {
        id: `person:${person.id}`,
        entityId: person.id,
        type: 'person',
        title: person.name,
        excerpt: '',
        url: `/people/${encodeURIComponent(person.id)}`,
        personIds,
        placeIds,
        creditIds: unique([
          ...(person.creditIds ?? []),
          ...person.biography.flatMap((paragraph) => paragraph.creditIds ?? []),
        ]),
        sourceIds,
        themes: [...person.themes],
        ...(person.portrait ? { portrait: { ...person.portrait } } : {}),
      },
      [person.summary, ...person.biography.map((paragraph) => paragraph.text)],
      [
        ...person.aliases,
        ...(person.occupations ?? []),
        ...relations.flatMap((relation) => [relation.label, relation.description]),
      ],
    );
    const portrait = person.portrait;
    if (portrait) {
      const source = sources.get(portrait.sourceId);
      const rights = portrait.rights?.trim() || source?.rights?.trim();
      // Only portraits with an explicit public source and rights statement enter photo discovery.
      if (source && rights)
        add(
          {
            id: `photo:portrait:${person.id}`,
            entityId: `portrait:${person.id}`,
            type: 'photo',
            title: `${person.name} — portrait`,
            excerpt: '',
            url: `/people/${encodeURIComponent(person.id)}#photo-portrait`,
            personIds,
            placeIds,
            creditIds: [...(portrait.creditIds ?? person.creditIds ?? [])],
            sourceIds: [portrait.sourceId],
            themes: [...person.themes],
            ...(source.date ? { date: source.date } : {}),
            photo: {
              url: portrait.url,
              alt: discoveryPlainText(portrait.alt),
              caption: discoveryPlainText(portrait.alt),
              creator: discoveryPlainText(portrait.credit),
              rights: discoveryPlainText(rights),
              sourceId: source.id,
            },
          },
          [portrait.alt, portrait.credit, rights],
        );
    }
  }
  for (const entry of data.contributions ?? []) {
    const personIds = publicRelatedPersonIds(entry);
    const placeIds = unique(entry.placeIds ?? []);
    const context = {
      personIds,
      placeIds,
      creditIds: [entry.creditId],
      sourceIds: unique(entry.sourceIds),
      themes: themesFor(personIds),
      date: entry.publishedAt,
      eventDate: entry.eventDate,
    };
    add(
      {
        ...context,
        id: `story:${entry.id}`,
        entityId: entry.id,
        type: 'story',
        storyKind: entry.kind,
        featured: entry.featured ?? false,
        title: entry.title,
        excerpt: '',
        url: `/contributions/${encodeURIComponent(entry.id)}`,
      },
      [
        entry.body,
        entry.context,
        entry.sourceCreator,
        entry.narrator,
        entry.holdingInstitution,
        entry.publicNote ?? '',
      ],
      entry.photos.flatMap((photo) => [photo.caption, photo.creator, photo.rights]),
    );
    for (const photo of entry.photos)
      add(
        {
          ...context,
          id: `photo:${photo.id}`,
          entityId: photo.id,
          type: 'photo',
          title: photo.caption,
          excerpt: '',
          url: `/contributions/${encodeURIComponent(entry.id)}#photo-${encodeURIComponent(photo.id)}`,
          creditIds: unique([photo.creditId, entry.creditId]),
          photo: {
            url: photo.url,
            alt: discoveryPlainText(photo.caption),
            caption: discoveryPlainText(photo.caption),
            creator: discoveryPlainText(photo.creator),
            rights: discoveryPlainText(photo.rights),
            width: photo.width,
            height: photo.height,
          },
        },
        [photo.caption, photo.creator, photo.rights],
        [entry.title],
      );
  }
  for (const material of data.materials) {
    const source = sources.get(material.sourceId);
    if (!source) continue;
    const personIds = publicRelatedPersonIds(material);
    add(
      {
        id: `material:${material.id}`,
        entityId: material.id,
        type: 'material',
        materialKind: material.kind,
        title: material.title,
        excerpt: '',
        url: `/people/${encodeURIComponent(material.personId)}#material-${encodeURIComponent(material.id)}`,
        personIds,
        placeIds: unique(material.placeIds ?? []),
        creditIds: [...(material.creditIds ?? [])],
        sourceIds: [material.sourceId],
        themes: themesFor(personIds),
        sourceUrl: source.url,
        ...((material.date ?? source.date) ? { date: material.date ?? source.date } : {}),
        eventDate: material.eventDate,
      },
      [material.description, material.narrator ?? '', material.interviewer ?? ''],
      [material.date ?? ''],
    );
  }
  return [...results.values()];
}

function relevance(item: IndexedResult, query: string, tokens: string[]) {
  if (!tokens.length) return item.result.type === 'story' && item.result.featured ? 1 : 0;
  return (
    (item.title === query
      ? 1000
      : item.title.startsWith(query)
        ? 600
        : item.title.includes(query)
          ? 400
          : 0) +
    tokens.filter((token) => item.title.includes(token)).length * 40 +
    { person: 4, story: 3, material: 2, photo: 1 }[item.result.type]
  );
}
const stableCompare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

export function discoverArchive(
  data: ArchiveData,
  rawInput: z.input<typeof discoveryInputSchema> = {},
): DiscoveryPage {
  const input = discoveryInputSchema.parse(rawInput);
  const query = normalized(input.q);
  const tokens = words(query);
  const filtered = discoveryIndex(data).filter(
    (item) =>
      (input.theme === 'all' || item.result.themes.includes(input.theme)) &&
      (!input.personId || item.result.personIds.includes(input.personId)) &&
      (!input.placeId || item.result.placeIds.includes(input.placeId)) &&
      (!input.featured || (item.result.type === 'story' && item.result.featured)) &&
      tokens.every((token) => item.text.includes(token)),
  );
  const counts: DiscoveryPage['counts'] = {
    all: filtered.length,
    person: 0,
    story: 0,
    material: 0,
    photo: 0,
  };
  filtered.forEach((item) => counts[item.result.type]++);
  const selected = filtered.filter(
    (item) => input.type === 'all' || item.result.type === input.type,
  );
  selected.sort(
    (left, right) =>
      (input.sort === 'recent'
        ? right.recent - left.recent
        : relevance(right, query, tokens) - relevance(left, query, tokens)) ||
      stableCompare(left.title, right.title) ||
      stableCompare(left.result.id, right.result.id),
  );
  const totalPages = Math.max(1, Math.ceil(selected.length / DISCOVERY_PAGE_SIZE));
  const page = Math.min(input.page, totalPages);
  return {
    items: selected
      .slice((page - 1) * DISCOVERY_PAGE_SIZE, page * DISCOVERY_PAGE_SIZE)
      .map((item) => ({ ...item.result, excerpt: excerpt(item.excerpts, tokens) })),
    total: selected.length,
    page,
    pageSize: DISCOVERY_PAGE_SIZE,
    totalPages,
    counts,
  };
}

/** All public matches, before pagination, so a story can reveal every associated map person. */
export function matchedPersonIds(data: ArchiveData, query: string): Set<string> {
  const tokens = words(query);
  return new Set(
    discoveryIndex(data)
      .filter((item) => tokens.every((token) => item.text.includes(token)))
      .flatMap((item) => item.result.personIds),
  );
}
