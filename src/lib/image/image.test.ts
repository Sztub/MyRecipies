import { describe, expect, it } from 'vitest';
import { fitWithin, ImageDecodeError, processImage, sha256Hex, type ImageCodec } from '.';

/** Fake codec: "encodes" to bytes derived from the size, so same input ⇒ same bytes. */
function fakeCodec(
  opts: { w?: number; h?: number; webp?: boolean; fail?: boolean } = {},
): ImageCodec & {
  released: number;
  types: string[];
} {
  const state = { released: 0, types: [] as string[] };
  return {
    ...state,
    get released() {
      return state.released;
    },
    get types() {
      return state.types;
    },
    async decode() {
      if (opts.fail) throw new Error('nope');
      return { width: opts.w ?? 4000, height: opts.h ?? 3000, source: null };
    },
    async encode(_d, size, type) {
      state.types.push(type);
      const t = type === 'image/webp' && !opts.webp ? 'image/png' : type;
      return new Blob([`${t}:${size.width}x${size.height}`], { type: t });
    },
    release() {
      state.released++;
    },
  };
}

describe('fitWithin', () => {
  it('downscales the longer side to 1600, keeping aspect ratio', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
  });
  it('never upscales', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('keeps at least 1px', () => {
    expect(fitWithin(100000, 10)).toEqual({ width: 1600, height: 1 });
  });
});

describe('sha256Hex', () => {
  it('matches the known digest of "abc"', async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('processImage', () => {
  it('resizes, falls back to JPEG when WebP is unsupported, and hashes the output', async () => {
    const codec = fakeCodec();
    const p = await processImage(new Blob(['x']), { codec });
    expect(codec.types).toEqual(['image/webp', 'image/jpeg']);
    expect(p.mime).toBe('image/jpeg');
    expect([p.width, p.height]).toEqual([1600, 1200]);
    expect(p.hash).toBe(await sha256Hex(p.blob));
    expect(p.size).toBe(p.blob.size);
    expect(codec.released).toBe(1);
  });
  it('uses WebP when supported', async () => {
    const p = await processImage(new Blob(['x']), { codec: fakeCodec({ webp: true }) });
    expect(p.mime).toBe('image/webp');
  });
  it('same image ⇒ same hash; different size ⇒ different hash', async () => {
    const a = await processImage(new Blob(['1']), { codec: fakeCodec() });
    const b = await processImage(new Blob(['2']), { codec: fakeCodec() });
    const c = await processImage(new Blob(['3']), { codec: fakeCodec({ w: 500, h: 500 }) });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
  });
  it('reports undecodable files as ImageDecodeError', async () => {
    await expect(
      processImage(new Blob(['x']), { codec: fakeCodec({ fail: true }) }),
    ).rejects.toBeInstanceOf(ImageDecodeError);
  });
});
