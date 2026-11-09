import { createHash, randomUUID } from 'node:crypto';
import {
  VET_MODEL,
  VET_PROMPT_VERSION,
  type Actor,
  type SubmissionRecord,
  type VetRun,
} from '@southview/validators';
import { getStore } from './connection';
import { DomainError } from './community';

export function requireVetReviewer(actor: Actor) {
  if (!actor.userId || !actor.reviewer)
    throw new DomainError('FORBIDDEN', 'Staff review access is required.');
}
/** Review decisions do not invalidate a check; new original material does. */
export function vetInputRevision(record: SubmissionRecord) {
  const { privateName, email, clientRequestId, permission, ...input } = record.input;
  return createHash('sha256')
    .update(
      JSON.stringify({
        input,
        photos: record.photos.map(({ originalKey, publicKey, ...photo }) => photo),
        supplements: record.supplements,
      }),
    )
    .digest('hex');
}
type Row = {
  id: string;
  submission_id: string;
  status: VetRun['status'];
  model: string;
  prompt_version: string;
  input_revision: string;
  started_at: Date | string;
  completed_at: Date | string | null;
  report: VetRun['report'];
  attachments: VetRun['attachments'];
  sources: VetRun['sources'];
  error: string | null;
};
const iso = (value: Date | string) => new Date(value).toISOString();
function decode(row: Row, record?: SubmissionRecord): VetRun {
  return {
    id: row.id,
    submissionId: row.submission_id,
    status: row.status,
    model: row.model,
    promptVersion: row.prompt_version,
    inputRevision: row.input_revision,
    startedAt: iso(row.started_at),
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    report: row.report,
    attachments: row.attachments,
    sources: row.sources,
    error: row.error,
    outdated: !!record && row.input_revision !== vetInputRevision(record),
  };
}
const expireSQL = `UPDATE community.vet_runs SET status='failed', completed_at=now(),
  error='The check was interrupted or timed out. Run Vet again.' WHERE status='running' AND expires_at <= now()`;

export async function latestVetRuns(actor: Actor, records: SubmissionRecord[]) {
  requireVetReviewer(actor);
  const store = await getStore();
  await store.query(expireSQL);
  const { rows } = await store.query<Row>(
    `SELECT DISTINCT ON (submission_id) * FROM community.vet_runs ORDER BY submission_id, started_at DESC, id DESC`,
  );
  const runs: Record<string, VetRun> = {};
  for (const row of rows) {
    const record = records.find((item) => item.id === row.submission_id);
    if (record) runs[record.id] = decode(row, record);
  }
  return runs;
}
export async function beginVet(record: SubmissionRecord, actor: Actor) {
  requireVetReviewer(actor);
  if (record.status === 'draft')
    throw new DomainError('BAD_REQUEST', 'Submit this draft before running Vet.');
  const store = await getStore();
  try {
    return await store.transaction(async (tx) => {
      await tx.query(expireSQL);
      const { rows } = await tx.query<Row>(
        `INSERT INTO community.vet_runs
        (id,submission_id,reviewer_id,status,model,prompt_version,input_revision,expires_at)
        VALUES ($1,$2,$3,'running',$4,$5,$6,now()+interval '5 minutes') RETURNING *`,
        [
          randomUUID(),
          record.id,
          actor.userId,
          VET_MODEL,
          VET_PROMPT_VERSION,
          vetInputRevision(record),
        ],
      );
      return decode(rows[0]!, record);
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      throw new DomainError('CONFLICT', 'Another Vet check is running. Wait for it to finish.');
    throw error;
  }
}
export async function finishVet(
  id: string,
  actor: Actor,
  result: Pick<VetRun, 'report' | 'attachments' | 'sources' | 'error'>,
) {
  requireVetReviewer(actor);
  const { rows } = await (
    await getStore()
  ).query<Row>(
    `UPDATE community.vet_runs SET status=$2,
    report=$3::jsonb, attachments=$4::jsonb, sources=$5::jsonb, error=$6, completed_at=now()
    WHERE id=$1 AND status='running' AND expires_at > now() RETURNING *`,
    [
      id,
      result.error ? 'failed' : 'completed',
      JSON.stringify(result.report),
      JSON.stringify(result.attachments),
      JSON.stringify(result.sources),
      result.error,
    ],
  );
  if (!rows[0])
    throw new DomainError('CONFLICT', 'This check expired. Refresh the desk and run Vet again.');
  return decode(rows[0]);
}
