import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { photos, recipes, resetDb } from '../../db';
import type { Photo } from '../../domain/types';
import { sha256Hex } from '../../lib/image';
import { findOrphanPhotos, PhotoPicker, PhotoView } from '.';

async function makePhoto(text: string): Promise<Photo> {
  const blob = new Blob([text], { type: 'image/jpeg' });
  return {
    hash: await sha256Hex(blob),
    mime: 'image/jpeg',
    width: 1,
    height: 1,
    size: blob.size,
    blob,
    createdAt: new Date().toISOString(),
  };
}

beforeEach(async () => {
  await resetDb();
});

describe('PhotoPicker', () => {
  it('processes a picked file, stores it once and appends its hash', async () => {
    const p = await makePhoto('same');
    const processor = vi.fn(async () => p);
    const onChange = vi.fn();
    const { rerender } = render(
      <PhotoPicker value={[]} onChange={onChange} processor={processor} />,
    );
    const input = screen.getByTestId('photo-gallery');
    await userEvent.upload(input, new File(['a'], 'a.jpg', { type: 'image/jpeg' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([p.hash]));
    expect(await photos.listHashes()).toEqual([p.hash]);

    // Same image again (e.g. via the camera input): stored once, hash not duplicated.
    rerender(<PhotoPicker value={[p.hash]} onChange={onChange} processor={processor} />);
    await userEvent.upload(
      screen.getByTestId('photo-camera'),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    );
    await waitFor(() => expect(processor).toHaveBeenCalledTimes(2));
    expect(await photos.listHashes()).toEqual([p.hash]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('shows an error instead of crashing when decoding fails', async () => {
    const onChange = vi.fn();
    render(
      <PhotoPicker
        value={[]}
        onChange={onChange}
        processor={async () => {
          throw new Error('heic');
        }}
      />,
    );
    await userEvent.upload(
      screen.getByTestId('photo-gallery'),
      new File(['x'], 'x.heic', { type: 'image/heic' }),
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a photo and respects max', async () => {
    const onChange = vi.fn();
    const p = await makePhoto('r');
    await photos.put(p);
    render(<PhotoPicker value={[p.hash]} onChange={onChange} max={1} />);
    expect(screen.getByTestId('photo-gallery')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe('PhotoView', () => {
  it('creates an object URL and revokes it on unmount', async () => {
    const create = vi.fn(() => 'blob:test-1');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const p = await makePhoto('v');
    await photos.put(p);
    const { unmount } = render(<PhotoView hash={p.hash} alt="Cake" />);
    const img = await screen.findByAltText('Cake');
    expect(img).toHaveAttribute('src', 'blob:test-1');
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:test-1');
  });

  it('shows a placeholder for unknown hashes', async () => {
    await act(async () => {
      render(<PhotoView hash="nope" />);
    });
    expect(await screen.findByRole('img', { name: 'Photo unavailable' })).toBeInTheDocument();
  });
});

describe('findOrphanPhotos', () => {
  it('returns stored photos not referenced by any recipe or step', async () => {
    const [a, b, c, d] = [
      await makePhoto('a'),
      await makePhoto('b'),
      await makePhoto('c'),
      await makePhoto('d'),
    ];
    for (const p of [a, b, c, d]) await photos.put(p);
    await recipes.save({
      title: 'R',
      tagIds: [],
      ingredients: [],
      steps: [{ id: 's1', text: 'x', photoHash: b.hash }],
      photoHashes: [a.hash],
    });
    expect(await findOrphanPhotos()).toEqual([c.hash, d.hash].sort());
  });
});
