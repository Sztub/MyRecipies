import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';
import { describe, expect, it } from 'vitest';
import { decodePairing, encodePairing, generatePairingCode, type PairingData } from './payload';

// Same settings as QrCode.tsx: automatic version, error correction M, byte mode, 4-module quiet zone.
function rasterize(text: string, scale = 4) {
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount();
  const size = (n + 8) * scale;
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      if (!q.isDark(r, c)) continue;
      for (let y = 0; y < scale; y++)
        for (let x = 0; x < scale; x++) {
          const i = (((r + 4) * scale + y) * size + (c + 4) * scale + x) * 4;
          px[i] = px[i + 1] = px[i + 2] = 0;
        }
    }
  return { px, size, modules: n };
}

describe('QR generate → jsQR decode', () => {
  it('a real pairing payload survives the QR round trip', async () => {
    const data: PairingData = {
      v: 1,
      createdAt: new Date().toISOString(),
      // Fine-grained GitHub tokens are 93 characters.
      github: {
        owner: 'some-family-owner',
        repo: 'family-recipes-data',
        branch: 'main',
        basePath: 'data/recipes',
        token: `test-token-${'x'.repeat(82)}`,
      },
      language: 'pl',
      backupKeepLast: 500,
      backupKeepDaily: 366,
    };
    const code = generatePairingCode();
    const payload = await encodePairing(data, code, { iterations: 1000 });
    const { px, size, modules } = rasterize(payload);
    expect(modules).toBeLessThanOrEqual(117); // ≤ version 25: still fine on a phone screen
    const found = jsQR(px, size, size);
    expect(found?.data).toBe(payload);
    await expect(decodePairing(found?.data ?? '', code)).resolves.toEqual(data);
  });
});
