import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { assertServer } from './config';
import { getStorage, MAX_PHOTO_BYTES, type ImageContentType, type PrivateStorage } from './storage';

export class InvalidPhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPhotoError';
  }
}
function sniff(bytes: Buffer): {
  format: 'jpeg' | 'png' | 'webp';
  extension: 'jpg' | 'png' | 'webp';
  contentType: ImageContentType;
} {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { format: 'jpeg', extension: 'jpg', contentType: 'image/jpeg' };
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return { format: 'png', extension: 'png', contentType: 'image/png' };
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  )
    return { format: 'webp', extension: 'webp', contentType: 'image/webp' };
  throw new InvalidPhotoError('Choose a JPEG, PNG, or WebP photograph.');
}

export async function processPhoto(input: Uint8Array) {
  assertServer();
  if (!input.byteLength || input.byteLength > MAX_PHOTO_BYTES)
    throw new InvalidPhotoError('Photos must be at most 10 MB.');
  const original = Buffer.from(input);
  const detected = sniff(original);
  try {
    const decoder = sharp(original, {
      failOn: 'warning',
      limitInputPixels: 40_000_000,
      animated: false,
    });
    const metadata = await decoder.metadata();
    if (
      metadata.format !== detected.format ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages ?? 1) > 1
    )
      throw new InvalidPhotoError('Choose a still JPEG, PNG, or WebP photograph.');
    // Sharp drops EXIF, XMP, IPTC, and other metadata unless explicitly requested.
    const prepared = decoder
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' });
    let { data: processed, info } = await prepared
      .clone()
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    // Keep approved previews below serverless response limits; retain the untouched original.
    if (processed.byteLength > 4 * 1024 * 1024)
      ({ data: processed, info } = await prepared
        .clone()
        .jpeg({ quality: 65, mozjpeg: true })
        .toBuffer({ resolveWithObject: true }));
    if (processed.byteLength > 4 * 1024 * 1024)
      throw new InvalidPhotoError('The processed photo is too large.');
    return {
      original,
      processed,
      originalContentType: detected.contentType,
      originalExtension: detected.extension,
      width: info.width,
      height: info.height,
      sha256: createHash('sha256').update(original).digest('hex'),
    };
  } catch (error) {
    if (error instanceof InvalidPhotoError) throw error;
    throw new InvalidPhotoError(
      'This photo could not be decoded. Choose a valid JPEG, PNG, or WebP.',
    );
  }
}

export async function savePhoto(input: Uint8Array, storage: PrivateStorage = getStorage()) {
  const photo = await processPhoto(input);
  const id = randomUUID();
  const originalKey = `originals/${id}.${photo.originalExtension}`;
  const processedKey = `processed/${id}.jpg`;
  await storage.write(originalKey, photo.original, photo.originalContentType);
  try {
    await storage.write(processedKey, photo.processed, 'image/jpeg');
  } catch (error) {
    await storage.delete(originalKey).catch(() => undefined);
    throw error;
  }
  return {
    originalKey,
    processedKey,
    contentType: 'image/jpeg' as const,
    originalContentType: photo.originalContentType,
    byteSize: photo.original.byteLength,
    width: photo.width,
    height: photo.height,
    sha256: photo.sha256,
  };
}
