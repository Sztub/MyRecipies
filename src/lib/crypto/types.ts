/**
 * base64 fields. `v: 1` = plain AES-GCM. `v: 2` = AES-GCM with additional authenticated data (AAD) that the
 * caller supplies on both sides (e.g. the file's repo path), so a ciphertext can't be moved to another place.
 */
export type Envelope = { v: 1 | 2; alg: 'AES-256-GCM'; iv: string; ct: string };

export type KeyCheck = {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // base64, not secret
  check: Envelope;
};

/** Base class for every error thrown by `src/lib/crypto`. Messages never contain secrets. */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

/** The passphrase does not match the KeyCheck. */
export class WrongPassphraseError extends CryptoError {
  constructor() {
    super('Wrong passphrase');
    this.name = 'WrongPassphraseError';
  }
}

/** Ciphertext was tampered with, encrypted with another key, or the envelope is malformed. */
export class DecryptError extends CryptoError {
  constructor(message = 'Decryption failed') {
    super(message);
    this.name = 'DecryptError';
  }
}
