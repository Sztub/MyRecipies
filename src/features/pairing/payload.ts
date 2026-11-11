// Pairing payload (README.md "Setting up a second device by QR"):
//   "recipes-pair:1:" + base64url(JSON(PairingEnvelope))
// PairingEnvelope = the usual AES-256-GCM Envelope plus the PBKDF2 salt + iteration count. The key comes
// from a one-time 10-character code shown next to the QR on the sending device. The content carries the
// GitHub settings incl. token, the UI language and the retention settings – NEVER the passphrase.
// Nothing here logs.

import { z } from 'zod';
import {
  DEFAULT_ITERATIONS,
  MAX_ITERATIONS,
  base64ToBytes,
  bytesToBase64,
  decrypt,
  encrypt,
  type Envelope,
} from '../../lib/crypto';

export const PAIRING_PREFIX = 'recipes-pair:1:';
/** No 0/O, 1/I/L – the code is read off a screen and typed on a phone. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/**
 * 31^10 ≈ 2^49.5. The code is the only secret protecting a captured QR / pairing text (which carries the
 * token) against an OFFLINE guess: the 1-hour expiry below is only checked by an honest receiver, so a copy
 * of the text stays attackable until the token itself expires. With PBKDF2 at 600 000 iterations each guess
 * is expensive; 8 characters (~2^40) were within reach of rented GPUs, 10 are ~1 000× further.
 */
export const CODE_LENGTH = 10;
const SALT_BYTES = 16;
/**
 * A pairing older than this is refused by the receiving app even with the right code (clocks of two family
 * phones are close). Usability guard only – it does not stop someone who copied the text from decrypting it.
 */
export const MAX_AGE_MS = 60 * 60 * 1000;
/** Allowed clock skew into the future. */
const MAX_FUTURE_MS = 10 * 60 * 1000;

export type PairingErrorKind = 'garbled' | 'wrong-code' | 'invalid-content' | 'expired';

export class PairingError extends Error {
  constructor(readonly kind: PairingErrorKind) {
    super(`Pairing failed: ${kind}`); // never includes payload or code
    this.name = 'PairingError';
  }
}

/**
 * Everything the second device needs. `.strict()` objects: an unknown key (e.g. a passphrase sneaked in by
 * a future change) makes the payload invalid rather than being silently carried along.
 */
export const pairingDataSchema = z
  .object({
    v: z.literal(1),
    createdAt: z.string(),
    github: z
      .object({
        owner: z.string().max(100),
        repo: z.string().max(100),
        branch: z.string().max(255),
        basePath: z.string().max(255),
        token: z.string().min(1).max(500),
      })
      .strict(),
    language: z.enum(['pl', 'en']),
    backupKeepLast: z.number().int().min(1).max(500).optional(),
    backupKeepDaily: z.number().int().min(0).max(366).optional(),
  })
  .strict();

export type PairingData = z.infer<typeof pairingDataSchema>;

const pairingEnvelopeSchema = z.object({
  v: z.literal(1),
  alg: z.literal('AES-256-GCM'),
  iv: z.string(),
  ct: z.string(),
  salt: z.string(),
  it: z.number().int().min(1).max(MAX_ITERATIONS),
});

type PairingEnvelope = Envelope & { salt: string; it: number };

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

// ---- code ----

/** Uniformly random code from CODE_ALPHABET (rejection sampling, Web Crypto randomness). */
export function generatePairingCode(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = '';
  while (out.length < CODE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

/** What the user typed → canonical code: upper case, separators/spaces dropped. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

/** "ABCDE-FGHJK" for display (two halves). */
export function formatCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

export function isWellFormedCode(input: string): boolean {
  const c = normalizeCode(input);
  return c.length === CODE_LENGTH && [...c].every((ch) => CODE_ALPHABET.includes(ch));
}

// ---- base64url ----

function toBase64Url(s: string): string {
  return bytesToBase64(enc.encode(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new PairingError('garbled');
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  try {
    return dec.decode(base64ToBytes(b64));
  } catch {
    throw new PairingError('garbled');
  }
}

// ---- key ----

async function deriveCodeKey(
  code: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const s = globalThis.crypto.subtle;
  const pw = await s.importKey('raw', enc.encode(normalizeCode(code)), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return s.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    pw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---- encode / decode ----

export interface EncodeOptions {
  /** Defaults to 600 000 like the passphrase key. Tests pass a low value. */
  iterations?: number;
}

/** Builds the QR / copy-paste text. `data` is validated first so nothing unexpected is ever encrypted. */
export async function encodePairing(
  data: PairingData,
  code: string,
  options: EncodeOptions = {},
): Promise<string> {
  const clean = pairingDataSchema.parse(data);
  if (!isWellFormedCode(code)) throw new Error('Invalid pairing code');
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveCodeKey(code, salt, iterations);
  const env = await encrypt(key, enc.encode(JSON.stringify(clean)));
  const outer: PairingEnvelope = { ...env, salt: bytesToBase64(salt), it: iterations };
  return PAIRING_PREFIX + toBase64Url(JSON.stringify(outer));
}

/** Cheap check before asking for the code: does this look like a pairing text at all? */
export function looksLikePairing(text: string): boolean {
  const t = text.replace(/\s/g, '');
  return t.startsWith(PAIRING_PREFIX) && t.length > PAIRING_PREFIX.length + 16;
}

/**
 * Opens a pairing text with the code. Throws `PairingError`:
 * `garbled` (not a pairing text / damaged), `wrong-code`, `invalid-content`, `expired`.
 */
export async function decodePairing(
  text: string,
  code: string,
  now: Date = new Date(),
): Promise<PairingData> {
  const t = text.replace(/\s/g, ''); // pasted text may be wrapped
  if (!t.startsWith(PAIRING_PREFIX)) throw new PairingError('garbled');
  let outer: z.infer<typeof pairingEnvelopeSchema>;
  try {
    const parsed = pairingEnvelopeSchema.safeParse(
      JSON.parse(fromBase64Url(t.slice(PAIRING_PREFIX.length))),
    );
    if (!parsed.success) throw new PairingError('garbled');
    outer = parsed.data;
  } catch {
    throw new PairingError('garbled');
  }
  if (!isWellFormedCode(code)) throw new PairingError('wrong-code');
  let salt: Uint8Array<ArrayBuffer>;
  try {
    salt = base64ToBytes(outer.salt);
  } catch {
    throw new PairingError('garbled');
  }
  if (salt.length < 8) throw new PairingError('garbled');
  const key = await deriveCodeKey(code, salt, outer.it);
  let plain: Uint8Array;
  try {
    plain = await decrypt(key, { v: outer.v, alg: outer.alg, iv: outer.iv, ct: outer.ct });
  } catch {
    // AES-GCM can't tell a wrong key from tampering; a wrong code is by far the likelier cause.
    throw new PairingError('wrong-code');
  }
  let data: PairingData;
  try {
    const parsed = pairingDataSchema.safeParse(JSON.parse(dec.decode(plain)));
    if (!parsed.success) throw new PairingError('invalid-content');
    data = parsed.data;
  } catch {
    throw new PairingError('invalid-content');
  }
  const created = Date.parse(data.createdAt);
  if (!Number.isFinite(created)) throw new PairingError('invalid-content');
  const age = now.getTime() - created;
  if (age > MAX_AGE_MS || age < -MAX_FUTURE_MS) throw new PairingError('expired');
  return data;
}
