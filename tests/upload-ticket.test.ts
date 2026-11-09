import assert from 'node:assert/strict';
import test from 'node:test';
import { createUploadTicket, verifyUploadTicket } from '@southview/services/upload-ticket';

test('upload tickets bind file size, submission, client identity, metadata, expiry and secret', async () => {
  const secret = 'upload-ticket-test-secret-at-least-32-bytes';
  const input = {
    submissionId: 'submission-a',
    photoId: 'photo-a',
    size: 10 * 1024 * 1024,
    contentType: 'image/png' as const,
    metadata: { caption: 'A photo', creator: 'A contributor' },
  };
  const { token, ticket } = await createUploadTicket(input, secret, 1000);
  assert.match(ticket.key, /^staging\/[a-f0-9-]{36}\.png$/);
  assert.equal((await verifyUploadTicket(token, input, secret, 2000)).size, input.size);
  for (const changed of [
    { ...input, submissionId: 'other' },
    { ...input, photoId: 'other' },
    { ...input, metadata: { caption: 'Changed' } },
  ])
    await assert.rejects(verifyUploadTicket(token, changed, secret, 2000), /invalid/);
  await assert.rejects(verifyUploadTicket(token, input, 'another-secret', 2000), /invalid/);
  await assert.rejects(verifyUploadTicket(token, input, secret, ticket.expiresAt), /expired/);
  const [body, mac] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...ticket, size: 1 })).toString('base64url');
  await assert.rejects(verifyUploadTicket(`${forged}.${mac}`, input, secret, 2000), /invalid/);
  await assert.rejects(verifyUploadTicket(`${body}.bad.extra`, input, secret, 2000), /invalid/);
  await assert.rejects(createUploadTicket({ ...input, size: input.size + 1 }, secret), /Invalid/);
});
