import {
  photoMetadataSchema,
  type SubmissionInput,
  type SubmissionRecord,
} from '@southview/validators';
import type { EditPhotoDraft } from './person-edit';
import { communityRequest, uploadCommunityPhoto } from './community-client';

/**
 * Sends one contribution through the existing community API: create the private draft, attach
 * photographs, then finalise it for review. Idempotent on retry because the draft is keyed by the
 * input's clientRequestId and the same receipt token.
 */
export async function sendContribution({
  input,
  receiptToken,
  photos,
  onProgress,
}: {
  input: SubmissionInput;
  receiptToken: string;
  photos: EditPhotoDraft[];
  onProgress?: (message: string) => void;
}): Promise<{ id: string; receiptUrl: string }> {
  onProgress?.('Saving…');
  const created = await communityRequest<{ id: string; status: string }>('/submissions', {
    method: 'POST',
    body: JSON.stringify({ input, receiptToken }),
  });
  const saved = await communityRequest<{ submission: SubmissionRecord }>(
    `/submissions/${encodeURIComponent(created.id)}`,
    {},
    receiptToken,
  );
  if (saved.submission.status !== 'draft') {
    // A retry after the earlier attempt already finished; nothing more to send.
    return { id: created.id, receiptUrl: `/submissions/${encodeURIComponent(created.id)}` };
  }
  await communityRequest(
    `/submissions/${encodeURIComponent(created.id)}`,
    { method: 'PATCH', body: JSON.stringify({ input }) },
    receiptToken,
  );
  const alreadyAttached = new Set(saved.submission.photos.map((photo) => photo.id));
  for (const [index, photo] of photos.entries()) {
    if (alreadyAttached.has(photo.clientPhotoId)) continue;
    if (!photo.file) throw new Error('A photograph is missing. Please choose it again.');
    onProgress?.(`Uploading photograph ${index + 1} of ${photos.length}…`);
    await uploadCommunityPhoto(
      created.id,
      photo.file,
      photo.clientPhotoId,
      photoMetadataSchema.parse(photo.metadata),
      receiptToken,
    );
  }
  onProgress?.('Sending for review…');
  const result = await communityRequest<{ receiptUrl: string }>(
    `/submissions/${encodeURIComponent(created.id)}/submit`,
    { method: 'POST' },
    receiptToken,
  );
  return { id: created.id, receiptUrl: result.receiptUrl };
}
