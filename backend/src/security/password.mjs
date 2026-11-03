import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const VERSION = "scrypt";
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const MAXMEM = 64 * 1024 * 1024;
const SALT_BYTES = 16;
const MIN_PASSWORD_BYTES = 12;
const MAX_PASSWORD_BYTES = 1024;

/**
 * Password verifier using Node's built-in scrypt implementation.
 * Store the returned encoded verifier only; never store or log plaintext passwords.
 * Parameters are versioned so they can be upgraded with a reviewed migration.
 */
export async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: COST, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: MAXMEM,
  });
  return [
    VERSION, COST, BLOCK_SIZE, PARALLELIZATION,
    salt.toString("base64url"), Buffer.from(derived).toString("base64url"),
  ].join("$");
}

/** Return false for malformed verifiers or invalid password input. */
export async function verifyPassword(password, encoded) {
  if (typeof password !== "string" || Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) return false;
  const parts = typeof encoded === "string" ? encoded.split("$") : [];
  if (parts.length !== 6 || parts[0] !== VERSION) return false;
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts;
  if (nRaw !== String(COST) || rRaw !== String(BLOCK_SIZE) || pRaw !== String(PARALLELIZATION)) return false;
  if (!/^[A-Za-z0-9_-]{22}$/.test(saltRaw) || !/^[A-Za-z0-9_-]{86}$/.test(hashRaw)) return false;
  const salt = Buffer.from(saltRaw, "base64url");
  const expected = Buffer.from(hashRaw, "base64url");
  if (salt.length !== SALT_BYTES || expected.length !== KEY_LENGTH) return false;
  try {
    const actual = Buffer.from(await scrypt(password, salt, KEY_LENGTH, {
      N: COST, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: MAXMEM,
    }));
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function validatePassword(password) {
  if (typeof password !== "string") throw new TypeError("Password must be a string");
  const bytes = Buffer.byteLength(password, "utf8");
  if (bytes < MIN_PASSWORD_BYTES || bytes > MAX_PASSWORD_BYTES) {
    throw new RangeError(`Password must contain between ${MIN_PASSWORD_BYTES} and ${MAX_PASSWORD_BYTES} UTF-8 bytes`);
  }
}
