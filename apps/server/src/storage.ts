/**
 * Files on disk. Layout inside the data directory:
 *   audio/<userId>/<uuid>.<ext>
 *   images/<userId>/<uuid>.webp
 *   tmp/<uuid>            uploads in progress
 * No path component ever comes from a client.
 */
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { config } from './config.js';
import { AppError } from './errors.js';

export interface AudioType {
  mime: string;
  ext: string;
}

/**
 * Identifies an audio container from the first bytes of a file. The type a browser
 * declares is ignored: it varies between browsers and proves nothing.
 */
export function detectAudioType(head: Buffer): AudioType | null {
  if (head.length < 12) return null;
  const ascii = (from: number, to: number) => head.subarray(from, to).toString('latin1');
  if (ascii(0, 3) === 'ID3') return { mime: 'audio/mpeg', ext: 'mp3' };
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
    // MPEG audio frame sync; ADTS (raw AAC) has layer bits 00.
    return (head[1] & 0x06) === 0
      ? { mime: 'audio/aac', ext: 'aac' }
      : { mime: 'audio/mpeg', ext: 'mp3' };
  }
  if (ascii(0, 4) === 'fLaC') return { mime: 'audio/flac', ext: 'flac' };
  if (ascii(4, 8) === 'ftyp') return { mime: 'audio/mp4', ext: 'm4a' };
  if (ascii(0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { mime: 'audio/wav', ext: 'wav' };
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return ascii(0, head.length).includes('webm') ? { mime: 'audio/webm', ext: 'webm' } : null;
  }
  return null;
}

export interface TempFile {
  path: string;
  sizeBytes: number;
  /** First bytes of the file, for type detection. */
  head: Buffer;
}

/**
 * Streams an upload to a temporary file without holding it in memory.
 * `truncated` is how the multipart parser reports that its size limit was hit.
 */
export async function receiveUpload(
  stream: Readable & { truncated?: boolean },
  maxBytes: number,
): Promise<TempFile> {
  await mkdir(config.tmpDir, { recursive: true });
  const path = join(config.tmpDir, randomUUID());
  try {
    await pipeline(stream, createWriteStream(path));
    const { size } = await stat(path);
    if (stream.truncated || size > maxBytes) {
      throw new AppError(413, 'file_too_large', `File is larger than ${maxBytes} bytes`);
    }
    if (size === 0) throw new AppError(400, 'validation', 'The file is empty');
    const handle = await open(path, 'r');
    try {
      const head = Buffer.alloc(Math.min(size, 64));
      await handle.read(head, 0, head.length, 0);
      return { path, sizeBytes: size, head };
    } finally {
      await handle.close();
    }
  } catch (error) {
    await removeFile(path);
    throw error;
  }
}

export function audioPath(fileKey: string): string {
  return join(config.audioDir, fileKey);
}

/** Path of an image relative to imageDir: `<ownerId>/<key>.webp` (the layout). */
export function imageRelPath(ownerId: string, imageKey: string): string {
  return `${ownerId}/${imageKey}.webp`;
}

export function imagePath(ownerId: string, imageKey: string): string {
  return join(config.imageDir, imageRelPath(ownerId, imageKey));
}

/** Moves a received upload to its final place and returns its key. */
export async function storeAudio(temp: TempFile, ownerId: string, ext: string): Promise<string> {
  const fileKey = `${ownerId}/${randomUUID()}.${ext}`;
  const target = audioPath(fileKey);
  await mkdir(dirname(target), { recursive: true });
  await rename(temp.path, target);
  return fileKey;
}

/** Deletes a file. A file that is already gone is not an error. */
export async function removeFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

/** Deletes every file of a user. */
export async function removeUserFiles(userId: string): Promise<void> {
  await rm(join(config.audioDir, userId), { recursive: true, force: true });
  await rm(join(config.imageDir, userId), { recursive: true, force: true });
}

/** A temporary image upload. */
export interface TempImage {
  uuid: string;
  /** Location of the uploaded file in tmpDir, for processing. */
  path: string;
  sizeBytes: number;
  /** First bytes of the file, for type detection. */
  head: Buffer;
  cleanup?: () => Promise<void>;
}

/** Reads an uploaded image file and returns a temp object. */
export async function readImageUpload(
  stream: Readable & { truncated?: boolean },
  maxBytes: number,
): Promise<TempImage> {
  const uuid = randomUUID();
  const tempPath = join(config.tmpDir, uuid);
  await mkdir(config.tmpDir, { recursive: true });

  try {
    await pipeline(stream, createWriteStream(tempPath));
    const { size } = await stat(tempPath);
    if (stream.truncated || size > maxBytes) {
      await rm(tempPath, { force: true });
      throw new AppError(413, 'file_too_large', `File is larger than ${maxBytes} bytes`);
    }
    const handle = await open(tempPath, 'r');
    try {
      const head = Buffer.alloc(Math.min(size, 64));
      await handle.read(head, 0, head.length, 0);
      return {
        uuid,
        path: tempPath,
        sizeBytes: size,
        head,
        cleanup: async () => await rm(tempPath, { force: true }),
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/** The edge of the square every uploaded illustration is re-encoded to. */
const IMAGE_EDGE = 512;

const NOT_AN_IMAGE = 'Not a readable image. Accepted: JPEG, PNG, WebP';

/** Sniffs the upload formats allows from the first bytes of the file. */
function detectImageType(head: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47
  ) {
    return 'png';
  }
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

export interface StoredImage {
  /**
   * The bare image key stored in the database: the uuid of the re-encoded WebP. The
   * client-visible URL is `/api/images/<key>` — a single path segment, so it matches
   * the route's `:key` param — and the file lives at imagePath(ownerId, key).
   */
  key: string;
  /** Byte size of the stored WebP: the size that counts against the quota. */
  bytes: number;
  /** Removes the stored file; used when the database update that records it fails. */
  cleanup: () => Promise<void>;
}

/**
 * Receives an uploaded image, rejects anything outside the allow-list
 * (JPEG, PNG or WebP, checked from the file's own bytes), re-encodes it as a
 * 512 px square WebP with all metadata stripped, and moves the re-encoded file
 * to its final place under imageDir. Nothing is left in tmpDir.
 */
export async function storeImage(
  stream: Readable & { truncated?: boolean },
  maxBytes: number,
  ownerId: string,
): Promise<StoredImage> {
  const temp = await readImageUpload(stream, maxBytes);
  const webpTemp = join(config.tmpDir, `${temp.uuid}.webp`);
  try {
    if (!detectImageType(temp.head)) {
      throw new AppError(415, 'unsupported_type', NOT_AN_IMAGE);
    }
    try {
      // rotate() applies the EXIF orientation before sharp strips every metadata block.
      await sharp(temp.path)
        .rotate()
        .resize(IMAGE_EDGE, IMAGE_EDGE, { fit: 'cover', position: 'centre' })
        .webp()
        .toFile(webpTemp);
    } catch {
      throw new AppError(415, 'unsupported_type', NOT_AN_IMAGE);
    }
    const target = imagePath(ownerId, temp.uuid);
    await mkdir(dirname(target), { recursive: true });
    await rename(webpTemp, target);
    const { size } = await stat(target);
    return { key: temp.uuid, bytes: size, cleanup: () => removeFile(target) };
  } finally {
    await rm(webpTemp, { force: true });
    await temp.cleanup?.();
  }
}
