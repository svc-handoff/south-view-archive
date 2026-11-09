import type { SubmissionRecord, SubmissionPhoto } from '@southview/validators';
export { safeCommunityNext } from '@southview/validators';

export type CommunitySession = {
  user: { id: string; name: string; email: string } | null;
  reviewer: boolean;
  mode: string;
  signInMethods: { google: boolean };
};
export class CommunityRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function communityRequest<T>(
  path: string,
  options: RequestInit = {},
  receiptToken?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (receiptToken) headers.set('X-Receipt-Token', receiptToken);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api/community${path}`, {
    ...options,
    headers,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new CommunityRequestError(
      'The archive returned an unexpected response. Please try again.',
      response.status,
    );
  }
  if (!response.ok)
    throw new CommunityRequestError(
      typeof result === 'object' &&
      result !== null &&
      'error' in result &&
      typeof result.error === 'string'
        ? result.error
        : 'This request could not be completed.',
      response.status,
    );
  return result as T;
}

export function receiptFor(id: string): string | undefined {
  if (typeof window === 'undefined') return;
  const receipt = new URLSearchParams(window.location.hash.slice(1)).get('receipt');
  try {
    if (receipt) {
      sessionStorage.setItem(`south-view-receipt:${id}`, receipt);
      return receipt;
    }
    return sessionStorage.getItem(`south-view-receipt:${id}`) ?? undefined;
  } catch {
    return receipt ?? undefined;
  }
}

/** Other submissions sent together with this one, listed in the private fragment as `also`. */
export function alsoFor(): string[] {
  if (typeof window === 'undefined') return [];
  const also = new URLSearchParams(window.location.hash.slice(1)).get('also') ?? '';
  return also
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^[a-zA-Z0-9_-]{1,80}$/.test(id))
    .slice(0, 20);
}

export function submissionReceiptUrl(id: string, token: string) {
  return `/submissions/${encodeURIComponent(id)}#receipt=${encodeURIComponent(token)}`;
}

export async function privatePhotoUrl(
  submissionId: string,
  photoId: string,
  token?: string,
  original = false,
) {
  const response = await fetch(
    `/api/community/submissions/${encodeURIComponent(submissionId)}/photos/${encodeURIComponent(photoId)}${original ? '?original=1' : ''}`,
    {
      headers: token ? { 'X-Receipt-Token': token } : {},
      cache: 'no-store',
      credentials: 'same-origin',
    },
  );
  if (!response.ok) throw new Error('The photograph could not be loaded.');
  if (response.headers.get('content-type')?.includes('application/json')) {
    const { downloadUrl } = (await response.json()) as { downloadUrl: string };
    const file = await fetch(downloadUrl, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    if (!file.ok) throw new Error('The photograph could not be loaded.');
    return URL.createObjectURL(await file.blob());
  }
  return URL.createObjectURL(await response.blob());
}

export async function uploadCommunityPhoto(
  submissionId: string,
  file: File,
  clientPhotoId: string,
  metadata: unknown,
  receiptToken?: string,
): Promise<{ photo: SubmissionPhoto }> {
  const path = `/submissions/${encodeURIComponent(submissionId)}/photos`;
  const input = { clientPhotoId, metadata, size: file.size, contentType: file.type };
  const prepared = await communityRequest<{
    mode?: 'proxy' | 'direct';
    photo?: SubmissionPhoto;
    url?: string;
    headers?: Record<string, string>;
    ticket?: string;
  }>(`${path}/upload`, { method: 'POST', body: JSON.stringify(input) }, receiptToken);
  if (prepared.photo) return { photo: prepared.photo };
  if (prepared.mode === 'direct' && prepared.url && prepared.ticket) {
    // This request carries only this file's short-lived signature, never the receipt or cookies.
    const response = await fetch(prepared.url, {
      method: 'PUT',
      body: file,
      headers: prepared.headers,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok)
      throw new Error(
        'The photograph could not be uploaded. Your text is saved; please try again.',
      );
    return communityRequest(
      `${path}/complete`,
      {
        method: 'POST',
        body: JSON.stringify({ clientPhotoId, metadata, ticket: prepared.ticket }),
      },
      receiptToken,
    );
  }
  if (prepared.mode !== 'proxy') throw new Error('Photo upload is unavailable. Please try again.');
  const body = new FormData();
  body.set('file', file);
  body.set('clientPhotoId', clientPhotoId);
  body.set('metadata', JSON.stringify(metadata));
  return communityRequest(path, { method: 'POST', body }, receiptToken);
}

export function statusLabel(status: SubmissionRecord['status']) {
  return {
    draft: 'Draft',
    pending: 'Awaiting review',
    'needs-information': 'More information requested',
    published: 'Published',
    rejected: 'Not accepted',
    withdrawn: 'Withdrawn',
  }[status];
}

export async function signOutCommunity() {
  const response = await fetch('/api/auth/sign-out', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error('Sign-out could not be completed. Please try again.');
  window.location.assign('/sign-in');
}
