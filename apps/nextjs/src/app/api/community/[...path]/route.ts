import { createHash } from 'node:crypto';
import { after } from 'next/server';
import { z, ZodError } from 'zod';
import { dataMode } from '@southview/db/connection';
import * as repository from '@southview/db/community';
import * as staffEdits from '@southview/db/staff-edits';
import { getSession, getSignInMethods, isReviewer } from '@southview/services/auth';
import { savePhoto, InvalidPhotoError } from '@southview/services/photos';
import { getStorage, MAX_PHOTO_BYTES, type PrivateStorage } from '@southview/services/storage';
import { createUploadTicket, verifyUploadTicket } from '@southview/services/upload-ticket';
import { getVetOverview, runVet } from '@southview/services/vet';
import {
  submissionInputSchema,
  photoMetadataSchema,
  reviewInputSchema,
  staffBiographySchema,
  staffContributionEditSchema,
  staffIssueCreateSchema,
  staffIssueSchema,
  staffLinkCreateSchema,
  staffLinkEditSchema,
  staffMaterialCreateSchema,
  staffMaterialSchema,
  staffPersonEditSchema,
  staffPlaceEditSchema,
  staffRemoveSchema,
  type Actor,
  type SubmissionRecord,
} from '@southview/validators';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
type Context = { params: Promise<{ path: string[] }> };
const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};
const receiptSchema = z
  .string()
  .min(64)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/);
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: privateHeaders });
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readBody(request: Request, limit: number) {
  if (Number(request.headers.get('content-length') ?? 0) > limit)
    throw new HttpError(413, 'This upload is too large.');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new HttpError(413, 'This upload is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
async function bodyJSON(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new HttpError(415, 'Send a JSON request.');
  try {
    return JSON.parse(new TextDecoder().decode(await readBody(request, 100_000))) as unknown;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'The request could not be read.');
  }
}
async function actorFor(request: Request): Promise<Actor> {
  const session = await getSession(request.headers);
  return {
    userId: session?.user.id ?? null,
    email: session?.user.emailVerified ? session.user.email : null,
    reviewer: session ? await isReviewer(session.user.id) : false,
    receiptToken: request.headers.get('X-Receipt-Token') ?? undefined,
  };
}
function privateView(record: SubmissionRecord, actor: Actor) {
  return {
    ...record,
    photos: record.photos.map(({ originalKey, publicKey, ...photo }) => photo),
    reviews: record.reviews.map((review) =>
      actor.reviewer
        ? review
        : {
            action: review.action,
            authorMessage: review.authorMessage,
            publicNote: review.publicNote,
            createdAt: review.createdAt,
          },
    ),
  };
}
function requireWriteOrigin(request: Request) {
  const expected = new URL(request.url).origin;
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  const allowed = new Set([
    ...(process.env.NODE_ENV !== 'production' ? [expected] : []),
    ...(configured ? [new URL(configured).origin] : []),
  ]);
  if (!allowed.has(request.headers.get('origin') ?? ''))
    throw new HttpError(403, 'Open the contribution form on this site to continue.');
}
async function limit(request: Request, bucket: string, max: number) {
  // Only trust a forwarded client address when the reverse proxy is explicitly configured.
  const address =
    process.env.TRUST_PROXY === '1'
      ? (request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown')
      : 'local-or-unproxied';
  const key = createHash('sha256').update(`${bucket}:${address}`).digest('hex');
  if (!(await repository.consumeRateLimit(key, max, 60 * 60 * 1000)))
    throw new HttpError(429, 'Please wait before trying again. Your saved contribution is safe.');
}
let lastStagingSweep = 0;
/**
 * Stores without expiry rules (Vercel Blob) keep interrupted uploads; at most hourly, after the
 * response, remove staging files more than a day old. Failures are ignored and retried later.
 */
function sweepStaging(storage: PrivateStorage) {
  if (!storage.removeStaleStaging || Date.now() - lastStagingSweep < 60 * 60 * 1000) return;
  lastStagingSweep = Date.now();
  after(() => storage.removeStaleStaging!(24 * 60 * 60 * 1000).catch(() => undefined));
}
function receiptURL(request: Request, id: string, token?: string) {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.NODE_ENV !== 'production' ? new URL(request.url).origin : null);
  if (!origin) throw new HttpError(503, 'The archive address has not been configured.');
  return `${origin.replace(/\/$/, '')}/submissions/${id}${token ? `#receipt=${token}` : ''}`;
}

async function handle(request: Request, context: Context): Promise<Response> {
  try {
    const { path } = await context.params;
    if (path.length > 5 || path.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part)))
      throw new HttpError(404, 'Not found.');
    const method = request.method;
    const mode = dataMode();
    if (method === 'GET' && path.join('/') === 'session') {
      if (mode === 'fixture')
        return json({ user: null, reviewer: false, mode, signInMethods: { google: false } });
      const session = await getSession(request.headers);
      return json({
        user: session
          ? { id: session.user.id, name: session.user.name, email: session.user.email }
          : null,
        reviewer: session ? await isReviewer(session.user.id) : false,
        mode,
        signInMethods: getSignInMethods(),
      });
    }
    if (mode === 'fixture')
      throw new HttpError(503, 'Contributions are unavailable in this read-only edition.');
    if (method !== 'GET') {
      requireWriteOrigin(request);
      await limit(request, 'requests', 240);
    }
    if (path[0] === 'media' && path.length === 2 && method === 'GET') {
      const photo = await repository.getPublicPhoto(path[1]!);
      if (!photo) throw new HttpError(404, 'Image not found.');
      const file = await (await getStorage()).read(photo.publicKey);
      if (!file) throw new HttpError(404, 'Image not found.');
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          ...privateHeaders,
          'Content-Type': 'image/jpeg',
          'Content-Disposition': 'inline; filename="archive-photo.jpg"',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    const actor = await actorFor(request);
    if (path.join('/') === 'submissions' && method === 'POST') {
      await limit(request, 'submissions', 20);
      const parsed = z
        .object({ input: submissionInputSchema, receiptToken: receiptSchema })
        .parse(await bodyJSON(request));
      const { submission, receiptToken } = await repository.createDraft(
        parsed.input,
        actor,
        parsed.receiptToken,
      );
      return json({ id: submission.id, receiptToken, status: submission.status }, 201);
    }
    if (path.join('/') === 'mine' && method === 'GET') {
      if (!actor.userId) throw new HttpError(401, 'Sign in to view your contributions.');
      return json({
        submissions: (await repository.listSubmissions(actor)).map((item) =>
          privateView(item, actor),
        ),
      });
    }
    if (path[0] === 'review') {
      if (!actor.reviewer) throw new HttpError(403, 'Staff review access is required.');
      if (path.length === 2 && path[1] === 'vet' && method === 'GET')
        return json(await getVetOverview(actor));
      if (path.length === 3 && path[2] === 'vet' && method === 'POST') {
        await runVet(path[1]!, actor);
        return json(await getVetOverview(actor));
      }
      if (path.length === 1 && method === 'GET')
        return json({
          submissions: (await repository.listReviewSubmissions(actor)).map((item) =>
            privateView(item, actor),
          ),
        });
      if (path.length === 2 && method === 'POST') {
        const review = reviewInputSchema.parse(await bodyJSON(request));
        // Contributors are not notified: they read decisions on their private receipt page.
        const result = await repository.reviewSubmission(path[1]!, review, actor);
        return json({ ...result, submission: privateView(result.submission, actor) });
      }
    }
    // Archive admin: direct staff corrections, each recorded with a reason and undoable.
    if (path[0] === 'admin') {
      if (!actor.reviewer) throw new HttpError(403, 'Staff access is required.');
      const [, area, id, action] = path;
      if (area === 'persons' && id && !action && method === 'GET')
        return json({ edits: await staffEdits.listStaffEdits({ personId: id }, actor) });
      if (area === 'persons' && id && !action && method === 'POST')
        return json(
          await staffEdits.editPerson(
            id,
            staffPersonEditSchema.parse(await bodyJSON(request)),
            actor,
          ),
        );
      if (area === 'persons' && id && action === 'biography' && method === 'POST')
        return json(
          await staffEdits.editBiography(
            id,
            staffBiographySchema.parse(await bodyJSON(request)),
            actor,
          ),
        );
      if (area === 'places' && id && !action && method === 'GET')
        return json({ edits: await staffEdits.listStaffEdits({ placeId: id }, actor) });
      if (area === 'places' && id && !action && method === 'POST')
        return json(
          await staffEdits.editPlace(
            id,
            staffPlaceEditSchema.parse(await bodyJSON(request)),
            actor,
          ),
        );
      if (area === 'links' && !id && method === 'POST')
        return json(
          await staffEdits.createLink(staffLinkCreateSchema.parse(await bodyJSON(request)), actor),
        );
      if (area === 'links' && id && !action && method === 'POST')
        return json(
          await staffEdits.editLink(id, staffLinkEditSchema.parse(await bodyJSON(request)), actor),
        );
      if (area === 'links' && id && action === 'remove' && method === 'POST') {
        const { reason } = staffRemoveSchema.parse(await bodyJSON(request));
        return json(await staffEdits.removeLink(id, reason, actor));
      }
      if (area === 'materials' && !id && method === 'POST')
        return json(
          await staffEdits.createMaterial(
            staffMaterialCreateSchema.parse(await bodyJSON(request)),
            actor,
          ),
        );
      if (area === 'materials' && id && !action && method === 'POST')
        return json(
          await staffEdits.editMaterial(
            id,
            staffMaterialSchema.parse(await bodyJSON(request)),
            actor,
          ),
        );
      if (area === 'materials' && id && action === 'remove' && method === 'POST') {
        const { reason } = staffRemoveSchema.parse(await bodyJSON(request));
        return json(await staffEdits.removeMaterial(id, reason, actor));
      }
      if (area === 'issues' && !id && method === 'POST')
        return json(
          await staffEdits.createIssue(
            staffIssueCreateSchema.parse(await bodyJSON(request)),
            actor,
          ),
        );
      if (area === 'issues' && id && !action && method === 'POST')
        return json(
          await staffEdits.editIssue(id, staffIssueSchema.parse(await bodyJSON(request)), actor),
        );
      if (area === 'issues' && id && action === 'remove' && method === 'POST') {
        const { reason } = staffRemoveSchema.parse(await bodyJSON(request));
        return json(await staffEdits.removeIssue(id, reason, actor));
      }
      if (area === 'contributions' && id && !action && method === 'POST')
        return json(
          await staffEdits.editContribution(
            id,
            staffContributionEditSchema.parse(await bodyJSON(request)),
            actor,
          ),
        );
      if (
        (area === 'persons' || area === 'places') &&
        id &&
        action === 'deletion' &&
        method === 'GET'
      )
        return json(
          await staffEdits.deletionImpact(area === 'persons' ? 'person' : 'place', id, actor),
        );
      if (
        (area === 'persons' || area === 'places') &&
        id &&
        action === 'delete' &&
        method === 'POST'
      ) {
        const { reason } = staffRemoveSchema.parse(await bodyJSON(request));
        return json(
          await staffEdits.deleteRecord(area === 'persons' ? 'person' : 'place', id, reason, actor),
        );
      }
      if (
        area === 'deleted' &&
        (id === 'persons' || id === 'places') &&
        !action &&
        method === 'GET'
      )
        return json({
          edits: await staffEdits.listDeleted(id === 'persons' ? 'person' : 'place', actor),
        });
      if (area === 'edits' && id && action === 'undo' && method === 'POST') {
        const { reason } = staffRemoveSchema.parse(await bodyJSON(request));
        return json(await staffEdits.undoStaffEdit(id, reason, actor));
      }
      throw new HttpError(404, 'Not found.');
    }
    if (path[0] === 'submissions' && path[1]) {
      const id = path[1];
      if (path.length === 2 && method === 'GET')
        return json({ submission: privateView(await repository.getSubmission(id, actor), actor) });
      if (path.length === 2 && method === 'PATCH') {
        const { input } = z.object({ input: submissionInputSchema }).parse(await bodyJSON(request));
        return json({
          submission: privateView(await repository.updateDraft(id, input, actor), actor),
        });
      }
      if (path.length === 3 && path[2] === 'submit' && method === 'POST') {
        // No receipt email exists: the private link returned here is the contributor's only copy.
        const submission = await repository.finalizeSubmission(id, actor);
        return json({
          submission: privateView(submission, actor),
          receiptUrl: receiptURL(request, id, actor.receiptToken),
        });
      }
      if (path.length === 3 && path[2] === 'supplements' && method === 'POST') {
        const { body } = z
          .object({ body: z.string().trim().min(3).max(20000) })
          .parse(await bodyJSON(request));
        return json({
          submission: privateView(await repository.addSupplement(id, body, actor), actor),
        });
      }
      if (path.length === 3 && path[2] === 'claim' && method === 'POST')
        return json({
          submission: privateView(await repository.claimSubmission(id, actor), actor),
        });
      if (path[2] === 'photos') {
        const submission = await repository.getSubmission(id, actor);
        if (path.length === 4 && ['upload', 'complete'].includes(path[3]!) && method === 'POST') {
          if (!['draft', 'needs-information'].includes(submission.status))
            throw new HttpError(
              409,
              'Attachments can be added to a draft or a requested supplement.',
            );
          await limit(request, 'photos', 60);
          const input = z
            .object({
              clientPhotoId: z.string().uuid(),
              metadata: photoMetadataSchema,
              size: z.number().int().min(1).max(MAX_PHOTO_BYTES).optional(),
              contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
              ticket: z.string().max(3000).optional(),
            })
            .parse(await bodyJSON(request));
          const existing = submission.photos.find((photo) => photo.id === input.clientPhotoId);
          if (existing) {
            const { originalKey, publicKey, ...photo } = existing;
            return json({ photo });
          }
          if (submission.photos.length >= 5)
            throw new HttpError(400, 'A contribution can have up to five photographs.');
          const storage = getStorage();
          if (path[3] === 'upload') {
            if (!storage.signUpload) return json({ mode: 'proxy' });
            if (!input.size || !input.contentType)
              throw new HttpError(400, 'Choose an image file.');
            if (!(await repository.consumeRateLimit(`photo-upload:${id}`, 20, 60 * 60 * 1000)))
              throw new HttpError(429, 'Please wait before uploading more photographs.');
            const { ticket, token } = await createUploadTicket({
              submissionId: id,
              photoId: input.clientPhotoId,
              size: input.size,
              contentType: input.contentType,
              metadata: input.metadata,
            });
            const signed = await storage.signUpload(ticket.key, ticket.size, ticket.contentType);
            sweepStaging(storage);
            return json({ mode: 'direct', ticket: token, ...signed });
          }
          let ticket;
          try {
            ticket = await verifyUploadTicket(input.ticket ?? '', {
              submissionId: id,
              photoId: input.clientPhotoId,
              metadata: input.metadata,
            });
          } catch {
            throw new HttpError(
              400,
              'This photo upload has expired or is invalid. Please upload it again.',
            );
          }
          try {
            const uploaded = await storage.read(ticket.key);
            if (
              !uploaded ||
              uploaded.bytes.length !== ticket.size ||
              uploaded.contentType !== ticket.contentType
            )
              throw new HttpError(400, 'The photo upload is incomplete. Please upload it again.');
            const saved = await savePhoto(uploaded.bytes, storage);
            const photo = {
              ...input.metadata,
              id: input.clientPhotoId,
              originalKey: saved.originalKey,
              publicKey: saved.processedKey,
              width: saved.width,
              height: saved.height,
              mimeType: saved.originalContentType,
              bytes: saved.byteSize,
            };
            try {
              if (saved.originalContentType !== ticket.contentType)
                throw new HttpError(400, 'The photo content does not match its file type.');
              await repository.attachPhoto(id, photo, actor);
            } catch (error) {
              await Promise.allSettled([
                storage.delete(saved.originalKey),
                storage.delete(saved.processedKey),
              ]);
              // A concurrent retry may have already attached the same client photo.
              const latest = await repository.getSubmission(id, actor);
              const winner = latest.photos.find((item) => item.id === input.clientPhotoId);
              if (!winner) throw error;
              const { originalKey, publicKey, ...metadata } = winner;
              return json({ photo: metadata });
            }
            const { originalKey, publicKey, ...metadata } = photo;
            return json({ photo: metadata }, 201);
          } finally {
            await storage.delete(ticket.key).catch(() => undefined);
          }
        }
        if (path.length === 3 && method === 'POST') {
          if (!['draft', 'needs-information'].includes(submission.status))
            throw new HttpError(
              409,
              'Attachments can be added to a draft or a requested supplement.',
            );
          await limit(request, 'photos', 60);
          const bytes = await readBody(request, 11 * 1024 * 1024);
          let form: FormData;
          try {
            form = await new Response(bytes, {
              headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
            }).formData();
          } catch {
            throw new HttpError(400, 'The photo upload could not be read. Please try again.');
          }
          const file = form.get('file');
          const clientPhotoId = z.string().uuid().parse(form.get('clientPhotoId'));
          const existingPhoto = submission.photos.find((photo) => photo.id === clientPhotoId);
          if (existingPhoto) {
            const { originalKey, publicKey, ...photo } = existingPhoto;
            return json({ photo });
          }
          if (submission.photos.length >= 5)
            throw new HttpError(400, 'A contribution can have up to five photographs.');
          if (!(file instanceof File)) throw new HttpError(400, 'Choose an image file.');
          let rawMetadata: unknown;
          try {
            rawMetadata = JSON.parse(String(form.get('metadata') ?? '{}'));
          } catch {
            throw new HttpError(400, 'Check the photograph caption, creator, and permission.');
          }
          const metadata = photoMetadataSchema.parse(rawMetadata);
          const saved = await savePhoto(Buffer.from(await file.arrayBuffer()));
          const photo = {
            ...metadata,
            id: clientPhotoId,
            originalKey: saved.originalKey,
            publicKey: saved.processedKey,
            width: saved.width,
            height: saved.height,
            mimeType: saved.originalContentType,
            bytes: saved.byteSize,
          };
          try {
            await repository.attachPhoto(id, photo, actor);
          } catch (error) {
            const storage = await getStorage();
            await Promise.allSettled([
              storage.delete(saved.originalKey),
              storage.delete(saved.processedKey),
            ]);
            throw error;
          }
          const { originalKey, publicKey, ...publicMetadata } = photo;
          return json({ photo: publicMetadata }, 201);
        }
        if (path.length === 4) {
          const photo = submission.photos.find((item) => item.id === path[3]);
          if (!photo) throw new HttpError(404, 'Image not found.');
          if (method === 'DELETE') {
            await repository.removePhoto(id, photo.id, actor);
            const storage = await getStorage();
            await Promise.allSettled([
              storage.delete(photo.originalKey),
              storage.delete(photo.publicKey),
            ]);
            return json({ ok: true });
          }
          if (method === 'GET') {
            const original = new URL(request.url).searchParams.get('original') === '1';
            const storage = getStorage();
            if (original && storage.signDownload)
              return json({ downloadUrl: await storage.signDownload(photo.originalKey) });
            const file = await (
              await getStorage()
            ).read(original ? photo.originalKey : photo.publicKey);
            if (!file) throw new HttpError(404, 'Image not found.');
            return new Response(new Uint8Array(file.bytes), {
              headers: {
                ...privateHeaders,
                'Content-Type': file.contentType,
                'Content-Disposition': `${original ? 'attachment' : 'inline'}; filename="${photo.id}${original ? '-original' : ''}"`,
                'X-Content-Type-Options': 'nosniff',
              },
            });
          }
        }
      }
    }
    throw new HttpError(404, 'Not found.');
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    if (error instanceof ZodError)
      return json({ error: error.issues[0]?.message ?? 'Please check the form.' }, 400);
    if (error instanceof InvalidPhotoError) return json({ error: error.message }, 400);
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    const statuses: Record<string, number> = {
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      UNAUTHORIZED: 401,
      CONFLICT: 409,
      VALIDATION: 400,
      BAD_REQUEST: 400,
      RATE_LIMITED: 429,
    };
    if (statuses[code])
      return json(
        {
          error:
            code === 'NOT_FOUND'
              ? error instanceof Error && error.message
                ? error.message
                : 'Contribution not found. Check your private receipt link.'
              : code === 'FORBIDDEN'
                ? 'You do not have access to this action.'
                : error instanceof Error
                  ? error.message
                  : 'Unable to complete this action.',
        },
        statuses[code],
      );
    // Do not serialize driver diagnostics, contact information, storage keys, or mail errors.
    console.error('Community request failed', error instanceof Error ? error.name : 'UnknownError');
    return json(
      {
        error:
          'This action could not be completed. Your saved information has been kept; please try again.',
      },
      500,
    );
  }
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
