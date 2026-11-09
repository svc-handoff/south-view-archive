import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { authSecret } from './config';
import { MAX_PHOTO_BYTES, type ImageContentType } from './storage-contract';

export type UploadTicket = {
  submissionId: string;
  photoId: string;
  key: string;
  size: number;
  contentType: ImageContentType;
  metadataHash: string;
  expiresAt: number;
};
const digest = (metadata: unknown) =>
  createHash('sha256').update(JSON.stringify(metadata)).digest('hex');
const signature = (body: string, secret: string) =>
  createHmac('sha256', secret).update(`south-view-upload-v1:${body}`).digest();

export async function createUploadTicket(
  input: {
    submissionId: string;
    photoId: string;
    size: number;
    contentType: ImageContentType;
    metadata: unknown;
  },
  secret?: string,
  now = Date.now(),
) {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[
    input.contentType
  ];
  if (
    !extension ||
    !Number.isSafeInteger(input.size) ||
    input.size < 1 ||
    input.size > MAX_PHOTO_BYTES
  )
    throw new Error('Invalid photo upload.');
  const ticket: UploadTicket = {
    submissionId: input.submissionId,
    photoId: input.photoId,
    key: `staging/${randomUUID()}.${extension}`,
    size: input.size,
    contentType: input.contentType,
    metadataHash: digest(input.metadata),
    expiresAt: now + 10 * 60 * 1000,
  };
  const body = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  return {
    ticket,
    token: `${body}.${signature(body, secret ?? (await authSecret())).toString('base64url')}`,
  };
}

export async function verifyUploadTicket(
  token: string,
  input: {
    submissionId: string;
    photoId: string;
    metadata: unknown;
  },
  secret?: string,
  now = Date.now(),
): Promise<UploadTicket> {
  try {
    if (token.length > 3000) throw new Error();
    const [body, provided, extra] = token.split('.');
    if (!body || !provided || extra) throw new Error();
    const expected = signature(body, secret ?? (await authSecret()));
    const actual = Buffer.from(provided, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const ticket = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as UploadTicket;
    if (
      ticket.submissionId !== input.submissionId ||
      ticket.photoId !== input.photoId ||
      ticket.metadataHash !== digest(input.metadata) ||
      ticket.expiresAt <= now ||
      !/^staging\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(ticket.key) ||
      !Number.isSafeInteger(ticket.size) ||
      ticket.size < 1 ||
      ticket.size > MAX_PHOTO_BYTES
    )
      throw new Error();
    return ticket;
  } catch {
    throw new Error('This photo upload has expired or is invalid. Please upload it again.');
  }
}
