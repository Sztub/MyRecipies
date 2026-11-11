import type { Photo } from '../../domain/types';
import { sha256Hex } from './hash';
import { fitWithin, JPEG_QUALITY, MAX_DIMENSION } from './size';

/** Thrown when the browser cannot decode the file (e.g. HEIC on a browser without support). */
export class ImageDecodeError extends Error {
  constructor(message = 'Image could not be decoded') {
    super(message);
    this.name = 'ImageDecodeError';
  }
}

export interface Decoded {
  width: number;
  height: number;
  /** Opaque handle passed back to `encode`. */
  source: unknown;
}

export interface ImageCodec {
  /** Decode with EXIF orientation applied. Throws on failure. */
  decode(file: Blob): Promise<Decoded>;
  /** Draw at the target size and encode. `type` is a request; the result's `type` is what was produced. */
  encode(
    decoded: Decoded,
    size: { width: number; height: number },
    type: string,
    quality: number,
  ): Promise<Blob>;
  /** Free decoded resources (optional). */
  release?(decoded: Decoded): void;
}

export interface ProcessOptions {
  maxDimension?: number;
  quality?: number;
  codec?: ImageCodec;
}

/**
 * Decode → downscale (max 1600 px) → re-encode (WebP if supported, else JPEG) → hash.
 * Re-encoding drops EXIF/GPS metadata. Identical output bytes ⇒ identical hash (dedupe by the store).
 */
export async function processImage(file: Blob, opts: ProcessOptions = {}): Promise<Photo> {
  const codec = opts.codec ?? browserCodec;
  let decoded: Decoded;
  try {
    decoded = await codec.decode(file);
  } catch (e) {
    throw e instanceof ImageDecodeError ? e : new ImageDecodeError();
  }
  try {
    if (!(decoded.width > 0 && decoded.height > 0)) throw new ImageDecodeError();
    const size = fitWithin(decoded.width, decoded.height, opts.maxDimension ?? MAX_DIMENSION);
    const quality = opts.quality ?? JPEG_QUALITY;
    let blob = await codec.encode(decoded, size, 'image/webp', quality);
    if (blob.type !== 'image/webp') blob = await codec.encode(decoded, size, 'image/jpeg', quality);
    if (blob.size === 0) throw new ImageDecodeError('Image could not be encoded');
    return {
      hash: await sha256Hex(blob),
      mime: blob.type || 'image/jpeg',
      width: size.width,
      height: size.height,
      size: blob.size,
      blob,
      createdAt: new Date().toISOString(),
    };
  } finally {
    codec.release?.(decoded);
  }
}

/** Real-browser codec (createImageBitmap + canvas). Not usable in jsdom. */
export const browserCodec: ImageCodec = {
  async decode(file) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { width: bmp.width, height: bmp.height, source: bmp };
    } catch {
      // Older Safari: fall back to an <img> element (browsers apply EXIF orientation when drawing).
      const url = URL.createObjectURL(file);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return { width: img.naturalWidth, height: img.naturalHeight, source: img };
      } catch {
        throw new ImageDecodeError();
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  },
  encode(decoded, { width, height }, type, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new ImageDecodeError('Canvas unavailable'));
    ctx.drawImage(decoded.source as CanvasImageSource, 0, 0, width, height);
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new ImageDecodeError('Image could not be encoded'))),
        type,
        quality,
      );
    });
  },
  release(decoded) {
    (decoded.source as { close?: () => void }).close?.();
  },
};
