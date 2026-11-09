/**
 * Records, oral histories and notes on a person's page.
 */
import { randomUUID } from 'node:crypto';
import {
  issueSchema,
  materialSchema,
  sourceSchema,
  staffIssueCreateSchema,
  staffIssueSchema,
  staffMaterialCreateSchema,
  staffMaterialSchema,
  staffReasonSchema,
  type Actor,
  type Material,
  type Source,
  type StaffIssue,
  type StaffIssueCreate,
  type StaffMaterial,
  type StaffMaterialCreate,
  type StaffSourceLink,
} from '@southview/validators';
import type { Store } from '../connection';
import { DomainError } from '../community';
import { type Data, type StaffChange, staffAction, existing, checkRelated } from './core';

/** Copies a link's fields onto a source, leaving out the optional ones left blank. */
function withLink(source: Data, link: StaffSourceLink, fallbackTitle: string): Data {
  const next: Data = {
    ...source,
    title: link.title || fallbackTitle,
    creator: link.creator,
    publisher: link.publisher,
    url: link.url,
  };
  if (link.rights) next.rights = link.rights;
  else delete next.rights;
  return next;
}

/**
 * Resolves the source a record cites: an existing one (with any corrections to its link written
 * first) or a new one made from a pasted link. Returns its id and the rows to write before the
 * record itself.
 */
async function materialSource(
  tx: Store,
  input: StaffMaterial,
): Promise<{ sourceId: string; changes: StaffChange[] }> {
  const { source, material } = input;
  if (source.mode === 'new') {
    const created = sourceSchema.parse(
      withLink(
        {
          id: `source-${randomUUID()}`,
          accessedAt: new Date().toISOString().slice(0, 10),
          kind: material.kind,
          creditIds: ['initial-compilation'],
        },
        source.link,
        material.title,
      ),
    );
    return {
      sourceId: created.id,
      changes: [{ table: 'sources', id: created.id, next: created }],
    };
  }
  const current = await existing<Source>(
    tx,
    'sources',
    source.sourceId,
    'Choose a source that is in the archive.',
  );
  if (!source.link) return { sourceId: current.id, changes: [] };
  if (current.kind === 'community-contribution')
    throw new DomainError(
      'BAD_REQUEST',
      'A contribution’s own source cannot be relinked. Choose or paste a different link instead.',
    );
  const next = sourceSchema.parse(withLink(current, source.link, material.title));
  return { sourceId: current.id, changes: [{ table: 'sources', id: current.id, next }] };
}

function materialData(base: Data, input: StaffMaterial, sourceId: string): Material {
  const { material } = input;
  const next: Data = {
    ...base,
    title: material.title,
    kind: material.kind,
    description: material.description,
    eventDate: material.eventDate,
    relatedPersonIds: material.relatedPersonIds,
    placeIds: material.placeIds,
    sourceId,
  };
  for (const field of ['narrator', 'interviewer', 'date'] as const) {
    if (material[field]) next[field] = material[field];
    else delete next[field];
  }
  return materialSchema.parse(next);
}

/**
 * Adds a record or oral history to a person's page. It links to the collection holding it: an
 * archive source already in use, or a new link pasted by staff.
 */
export async function createMaterial(raw: StaffMaterialCreate, actor: Actor) {
  const input = staffMaterialCreateSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    await existing(tx, 'persons', input.personId, 'This person is not in the archive.');
    await checkRelated(tx, input.personId, input.material);
    const source = await materialSource(tx, input);
    const material = materialData(
      {
        id: `material-${randomUUID()}`,
        personId: input.personId,
        creditIds: ['initial-compilation'],
      },
      input,
      source.sourceId,
    );
    return {
      result: { material },
      reason: input.reason,
      changes: [...source.changes, { table: 'materials', id: material.id, next: material }],
    };
  });
}

/** Corrects a record or oral history, and optionally the link to the collection holding it. */
export async function editMaterial(materialId: string, raw: StaffMaterial, actor: Actor) {
  const input = staffMaterialSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    const current = await existing<Material>(
      tx,
      'materials',
      materialId,
      'This record is not in the archive.',
    );
    await checkRelated(tx, current.personId, input.material);
    const source = await materialSource(tx, input);
    const material = materialData(current, input, source.sourceId);
    return {
      result: { material },
      reason: input.reason,
      changes: [...source.changes, { table: 'materials', id: materialId, next: material }],
    };
  });
}

/** Takes a record or oral history off the person's page. The source it cited stays. */
export async function removeMaterial(materialId: string, rawReason: string, actor: Actor) {
  const reason = staffReasonSchema.parse(rawReason);
  return staffAction(actor, async (tx) => {
    await existing(tx, 'materials', materialId, 'This record is not in the archive.');
    return { result: {}, reason, changes: [{ table: 'materials', id: materialId, next: null }] };
  });
}

async function issueData(tx: Store, personId: string, input: StaffIssue): Promise<Data> {
  for (const id of input.sourceIds)
    await existing(tx, 'sources', id, 'Choose sources that are in the archive.');
  return issueSchema.parse({
    personId,
    field: input.field,
    note: input.note,
    sourceIds: input.sourceIds,
  });
}

/** Adds a public note to a person's record, for example where sources disagree about a date. */
export async function createIssue(raw: StaffIssueCreate, actor: Actor) {
  const input = staffIssueCreateSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    await existing(tx, 'persons', input.personId, 'This person is not in the archive.');
    const id = `issue-${randomUUID()}`;
    const issue = await issueData(tx, input.personId, input);
    return {
      result: { issue: { ...issue, id } },
      reason: input.reason,
      changes: [{ table: 'issues', id, next: issue }],
    };
  });
}

/** Rewrites a note on a person's record and the sources it cites. */
export async function editIssue(issueId: string, raw: StaffIssue, actor: Actor) {
  const input = staffIssueSchema.parse(raw);
  return staffAction(actor, async (tx) => {
    const current = await existing<{ personId: string }>(
      tx,
      'issues',
      issueId,
      'This note is not in the archive.',
    );
    const issue = await issueData(tx, current.personId, input);
    return {
      result: { issue: { ...issue, id: issueId } },
      reason: input.reason,
      changes: [{ table: 'issues', id: issueId, next: issue }],
    };
  });
}

/** Takes a note off a person's record. */
export async function removeIssue(issueId: string, rawReason: string, actor: Actor) {
  const reason = staffReasonSchema.parse(rawReason);
  return staffAction(actor, async (tx) => {
    await existing(tx, 'issues', issueId, 'This note is not in the archive.');
    return { result: {}, reason, changes: [{ table: 'issues', id: issueId, next: null }] };
  });
}
