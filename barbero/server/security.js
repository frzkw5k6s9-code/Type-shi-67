import { pbkdf2, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

const pbkdf2Async = promisify(pbkdf2);

export const HASH_ID = 'pbkdf2-sha256';
const KEY_BYTES = 32;
const SALT_BYTES = 16;

export const sha256Hex = (s) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Constant-time string comparison (length differences are not secret here). */
export function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Loads (or creates, 0600) the server-side secret "pepper". It is mixed into every
 * password with HMAC-SHA-256 BEFORE the salted key-stretching step, so a stolen
 * database alone is not enough to run an offline guessing attack.
 */
export function loadPepper(cfg) {
  if (cfg.pepperEnv) return Buffer.from(cfg.pepperEnv, 'utf8');
  const file = resolve(cfg.dataDir, 'pepper.key');
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64url');
  const key = randomBytes(32);
  writeFileSync(file, key.toString('base64url'), { mode: 0o600 });
  chmodSync(file, 0o600);
  return key;
}

/**
 * Password hashing: HMAC-SHA-256(pepper, password)  ->  PBKDF2-HMAC-SHA-256
 * with a unique random 128-bit salt per user and a high iteration count.
 *
 * Stored as:  pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>
 *
 * (A single round of "SHA-256(salt + password)" can be brute-forced at billions of
 * guesses per second on a GPU. Iterating HMAC-SHA-256 hundreds of thousands of times
 * keeps the SHA-256 + per-user salt design you asked for, but makes each guess expensive.)
 */
export function makeHasher({ iterations, pepper }) {
  const prehash = (password) => createHmac('sha256', pepper).update(password, 'utf8').digest();

  async function hash(password) {
    const salt = randomBytes(SALT_BYTES);
    const dk = await pbkdf2Async(prehash(password), salt, iterations, KEY_BYTES, 'sha256');
    return `${HASH_ID}$${iterations}$${salt.toString('base64url')}$${dk.toString('base64url')}`;
  }

  /** @returns {Promise<{ok:boolean, needsRehash:boolean}>} */
  async function verify(password, stored) {
    const parts = String(stored).split('$');
    if (parts.length !== 4 || parts[0] !== HASH_ID) return { ok: false, needsRehash: false };
    const iter = Number(parts[1]);
    if (!Number.isInteger(iter) || iter < 1 || iter > 5_000_000) return { ok: false, needsRehash: false };
    const salt = Buffer.from(parts[2], 'base64url');
    const expected = Buffer.from(parts[3], 'base64url');
    const dk = await pbkdf2Async(prehash(password), salt, iter, expected.length, 'sha256');
    const ok = expected.length === dk.length && timingSafeEqual(expected, dk);
    return { ok, needsRehash: ok && iter < iterations };
  }

  // A throw-away hash so that "unknown e-mail" costs the same time as "wrong password".
  let dummy;
  async function verifyDummy(password) {
    dummy ??= await hash(randomToken(12));
    await verify(password, dummy);
    return { ok: false, needsRehash: false };
  }

  return { hash, verify, verifyDummy };
}

const COMMON = new Set(
  (
    'password,password1,password12,password123,password1234,passw0rd,p@ssw0rd,qwerty,qwertyuiop,qwerty123,qwerty12345,' +
    '1234567890,12345678,123456789,0123456789,1q2w3e4r5t,1qaz2wsx,iloveyou,letmein123,welcome123,admin12345,administrator,' +
    'abc123456,abcd1234,111111111,000000000,barbero,barbero123,barbero1234,barbero2024,barbero2025,barbero2026,' +
    'jeddah123,jeddah1234,saudi123456,saudiarabia,ahmed12345,mohammed123,mohammad123,football123,monkey1234,dragon1234'
  ).split(',')
);

/** Returns an error code (matches the `err.*` i18n keys) or null if the password is acceptable. */
export function checkPasswordPolicy(password, { email = '', name = '' } = {}) {
  if (typeof password !== 'string') return 'password_invalid';
  if (password.length < 10) return 'password_too_short';
  if (password.length > 128) return 'password_too_long';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'password_common';
  if (new Set(password).size < 5) return 'password_weak';
  if (/^[0-9]+$/.test(password)) return 'password_weak';
  const local = email.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) return 'password_contains_identity';
  const first = name.trim().split(/\s+/)[0]?.toLowerCase();
  if (first && first.length >= 4 && lower.includes(first)) return 'password_contains_identity';
  return null;
}
