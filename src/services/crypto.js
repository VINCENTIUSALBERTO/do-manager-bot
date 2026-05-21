import crypto from 'node:crypto';

import { config } from '../config.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const KEY = Buffer.from(config.ENCRYPTION_KEY, 'hex');

if (KEY.length !== 32) {
  throw new Error('ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars)');
}

/**
 * Encrypts a plaintext string using AES-256-GCM. Returns a compact string
 * `<iv>:<authTag>:<ciphertext>` (all base64) so it can be stored as a single
 * field in MongoDB without a sub-document.
 */
export function encrypt(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encrypt: plaintext must be a non-empty string');
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
    ':',
  );
}

/**
 * Decrypts a value produced by {@link encrypt}. Throws if the payload was
 * tampered with or the wrong key is used.
 */
export function decrypt(payload) {
  if (typeof payload !== 'string') {
    throw new Error('decrypt: payload must be a string');
  }
  const parts = payload.split(':');
  if (parts.length !== 3) {
    throw new Error('decrypt: malformed payload');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * Generates a cryptographically strong random password using URL-safe chars.
 * DigitalOcean requires that root passwords be 8-128 chars and include a mix
 * of cases, digits and symbols, so we guarantee that here.
 */
export function generateStrongPassword(length = 20) {
  if (length < 12) length = 12;
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*-_=+';
  const all = lower + upper + digits + symbols;
  const buf = crypto.randomBytes(length);
  const chars = [
    lower[crypto.randomInt(lower.length)],
    upper[crypto.randomInt(upper.length)],
    digits[crypto.randomInt(digits.length)],
    symbols[crypto.randomInt(symbols.length)],
  ];
  for (let i = chars.length; i < length; i += 1) {
    chars.push(all[buf[i] % all.length]);
  }
  // Fisher-Yates shuffle so the guaranteed chars aren't always first.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
