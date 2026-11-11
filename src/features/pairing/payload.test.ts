import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_AGE_MS,
  PAIRING_PREFIX,
  PairingError,
  decodePairing,
  encodePairing,
  formatCode,
  generatePairingCode,
  isWellFormedCode,
  looksLikePairing,
  normalizeCode,
  type PairingData,
} from './payload';

const IT = { iterations: 1000 };
const TOKEN =
  'test-token-pairing-0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuv';
const NOW = new Date('2026-11-10T12:00:00.000Z');

const data: PairingData = {
  v: 1,
  createdAt: NOW.toISOString(),
  github: {
    owner: 'octo',
    repo: 'family-recipes-data',
    branch: 'main',
    basePath: 'recipes',
    token: TOKEN,
  },
  language: 'pl',
  backupKeepLast: 30,
  backupKeepDaily: 14,
};

async function expectKind(p: Promise<unknown>, kind: PairingError['kind']) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PairingError);
  expect((err as PairingError).kind).toBe(kind);
  // Errors never echo secrets.
  expect(String((err as Error).message)).not.toContain(TOKEN);
}

function wrap(outer: unknown): string {
  return (
    PAIRING_PREFIX +
    btoa(JSON.stringify(outer)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  );
}

function innerJson(payload: string): Record<string, unknown> {
  const b64 = payload.slice(PAIRING_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as Record<string, unknown>;
}

describe('pairing code', () => {
  it('has 10 characters from the unambiguous alphabet and varies', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = generatePairingCode();
      expect(c).toHaveLength(CODE_LENGTH);
      expect([...c].every((ch) => CODE_ALPHABET.includes(ch))).toBe(true);
      codes.add(c);
    }
    expect(codes.size).toBeGreaterThan(195);
    expect(CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });
  it('normalizes what people type', () => {
    expect(normalizeCode(' abcde-fghjk ')).toBe('ABCDEFGHJK');
    expect(formatCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK');
    expect(isWellFormedCode('abcde fghjk')).toBe(true);
    expect(isWellFormedCode('ABCDEFGHJ')).toBe(false);
    expect(isWellFormedCode('ABCDEFGHJ0')).toBe(false);
  });
});

describe('encodePairing / decodePairing', () => {
  it('round-trips with the right code (typed in any case/format)', async () => {
    const code = generatePairingCode();
    const payload = await encodePairing(data, code, IT);
    expect(payload.startsWith(PAIRING_PREFIX)).toBe(true);
    expect(payload.slice(PAIRING_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, safe in a QR
    expect(looksLikePairing(payload)).toBe(true);
    const typed = formatCode(code).toLowerCase();
    await expect(decodePairing(payload, typed, NOW)).resolves.toEqual(data);
  });

  it('accepts text that got wrapped when pasted', async () => {
    const code = generatePairingCode();
    const payload = await encodePairing(data, code, IT);
    const wrapped = `  ${payload.slice(0, 40)}\n${payload.slice(40, 90)}\r\n${payload.slice(90)}\n`;
    await expect(decodePairing(wrapped, code, NOW)).resolves.toEqual(data);
  });

  it('uses a fresh salt and IV each time', async () => {
    const code = generatePairingCode();
    const a = innerJson(await encodePairing(data, code, IT));
    const b = innerJson(await encodePairing(data, code, IT));
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a).toMatchObject({ v: 1, alg: 'AES-256-GCM', it: 1000 });
  });

  it('defaults to 600 000 PBKDF2 iterations', async () => {
    const payload = await encodePairing(data, generatePairingCode());
    expect(innerJson(payload).it).toBe(600_000);
  });

  it('rejects a wrong code', async () => {
    const payload = await encodePairing(data, 'ABCDEFGHJK', IT);
    await expectKind(decodePairing(payload, 'ABCDEFGHJM', NOW), 'wrong-code');
    await expectKind(decodePairing(payload, 'short', NOW), 'wrong-code');
  });

  it('rejects garbled payloads', async () => {
    const code = generatePairingCode();
    const payload = await encodePairing(data, code, IT);
    await expectKind(decodePairing('hello', code, NOW), 'garbled');
    await expectKind(decodePairing(`${PAIRING_PREFIX}%%%`, code, NOW), 'garbled');
    await expectKind(decodePairing(`${PAIRING_PREFIX}${btoa('{"v":1}')}`, code, NOW), 'garbled');
    await expectKind(decodePairing(payload.slice(0, payload.length - 30), code, NOW), 'garbled');
    await expectKind(
      decodePairing(payload.replace(PAIRING_PREFIX, 'recipes-pair:2:'), code, NOW),
      'garbled',
    );
  });

  it('detects a tampered ciphertext (GCM tag) – reported as wrong code', async () => {
    const code = generatePairingCode();
    const outer = innerJson(await encodePairing(data, code, IT));
    const ct = String(outer.ct);
    const flipped = (ct[5] === 'A' ? 'B' : 'A') + '';
    const tampered = { ...outer, ct: ct.slice(0, 5) + flipped + ct.slice(6) };
    const text = wrap(tampered);
    await expectKind(decodePairing(text, code, NOW), 'wrong-code');
  });

  it('refuses a hostile iteration count', async () => {
    const code = generatePairingCode();
    const outer = innerJson(await encodePairing(data, code, IT));
    const text = wrap({ ...outer, it: 1e12 });
    await expectKind(decodePairing(text, code, NOW), 'garbled');
  });

  it('refuses an old (or far-future) pairing', async () => {
    const code = generatePairingCode();
    const payload = await encodePairing(data, code, IT);
    await expectKind(
      decodePairing(payload, code, new Date(NOW.getTime() + MAX_AGE_MS + 1)),
      'expired',
    );
    await expectKind(
      decodePairing(payload, code, new Date(NOW.getTime() - 60 * 60 * 1000)),
      'expired',
    );
    await expect(
      decodePairing(payload, code, new Date(NOW.getTime() + 5 * 60 * 1000)),
    ).resolves.toEqual(data);
  });
});

describe('the passphrase is never part of the payload', () => {
  it('encodePairing refuses extra fields such as a passphrase', async () => {
    const withPass = {
      ...data,
      passphrase: 'correct horse battery staple',
    } as unknown as PairingData;
    await expect(encodePairing(withPass, generatePairingCode(), IT)).rejects.toThrow();
    const nested = {
      ...data,
      github: { ...data.github, passphrase: 'correct horse battery staple' },
    } as unknown as PairingData;
    await expect(encodePairing(nested, generatePairingCode(), IT)).rejects.toThrow();
  });

  it('a decrypted payload with a passphrase field is rejected, not applied', async () => {
    // Craft a payload the way a buggy/old sender might, bypassing encodePairing's validation.
    const code = 'ABCDEFGHJK';
    const s = crypto.subtle;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const pw = await s.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, [
      'deriveKey',
    ]);
    const key = await s.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1000 },
      pw,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify({ ...data, passphrase: 'x' }));
    const ct = new Uint8Array(await s.encrypt({ name: 'AES-GCM', iv }, key, plain));
    const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
    const outer = { v: 1, alg: 'AES-256-GCM', iv: b64(iv), ct: b64(ct), salt: b64(salt), it: 1000 };
    const text = wrap(outer);
    await expectKind(decodePairing(text, code, NOW), 'invalid-content');
  });

  it('the payload text contains neither the token nor its base64 forms', async () => {
    const payload = await encodePairing(data, generatePairingCode(), IT);
    expect(payload).not.toContain(TOKEN);
    expect(payload).not.toContain(btoa(TOKEN).slice(0, 20));
    expect(JSON.stringify(innerJson(payload))).not.toContain('test-token');
  });

  it('fits comfortably in a QR code', async () => {
    const payload = await encodePairing(data, generatePairingCode(), IT);
    expect(payload.length).toBeLessThan(1000); // QR version ≤ ~25 at level M
  });
});
