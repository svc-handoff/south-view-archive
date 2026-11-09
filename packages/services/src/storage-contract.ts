export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export type ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';
export type PrivateObject = { bytes: Buffer; contentType: ImageContentType };
export interface PrivateStorage {
  write(key: string, bytes: Buffer, contentType: ImageContentType): Promise<void>;
  read(key: string): Promise<PrivateObject | null>;
  delete(key: string): Promise<void>;
  signUpload?(
    key: string,
    size: number,
    contentType: ImageContentType,
  ): Promise<{ url: string; headers: Record<string, string> }>;
  signDownload?(key: string): Promise<string>;
  /**
   * Removes `staging/` uploads older than `olderThanMs` that were never completed, for stores
   * without their own expiry rules. Returns how many were removed.
   */
  removeStaleStaging?(olderThanMs: number): Promise<number>;
}

export function validateStorageKey(key: string) {
  if (!/^(originals|processed|staging)\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(key))
    throw new Error('Invalid private object key.');
  return key;
}

export function contentTypeFor(key: string): ImageContentType {
  return key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
}

export function validWrite(key: string, bytes: Buffer, contentType: ImageContentType) {
  validateStorageKey(key);
  if (!bytes.byteLength || bytes.byteLength > MAX_PHOTO_BYTES)
    throw new Error('Photos must be at most 10 MB.');
  if (contentType !== contentTypeFor(key))
    throw new Error('Photo type does not match its private object key.');
}
