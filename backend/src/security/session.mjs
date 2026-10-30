import { createHash, randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAME = "__Host-userdie_session";
export const SESSION_TOKEN_BYTES = 32;

/**
 * Create a high-entropy opaque bearer token for a future server-side session.
 * Persist only tokenHash; return token only once to the caller for the cookie.
 */
export function createSessionToken() {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashSessionToken(token),
  };
}

/** SHA-256 digest for indexed lookup; never persist the raw cookie token. */
export function hashSessionToken(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new TypeError("Session token has an invalid format");
  }
  return createHash("sha256").update(token, "utf8").digest();
}

/**
 * Serialize a host-only, HttpOnly, SameSite=Lax cookie.
 * The __Host- prefix requires Secure, Path=/ and no Domain attribute.
 */
export function serializeSessionCookie(token, { maxAgeSeconds } = {}) {
  hashSessionToken(token);
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 604800) {
    throw new RangeError("maxAgeSeconds must be between 1 and 604800");
  }
  return [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

export function serializeClearedSessionCookie() {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
}

/** Return exactly one valid session cookie; duplicate cookie names fail closed. */
export function readSessionCookie(cookieHeader) {
  if (typeof cookieHeader !== "string" || cookieHeader.length > 8192) return null;
  const matches = cookieHeader.split(";").map((part) => part.trim())
    .filter((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(SESSION_COOKIE_NAME.length + 1);
  try {
    hashSessionToken(token);
    return token;
  } catch {
    return null;
  }
}
