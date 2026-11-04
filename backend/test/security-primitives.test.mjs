import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionToken,
  hashSessionToken,
  readSessionCookie,
  serializeSessionCookie,
  serializeClearedSessionCookie,
  SESSION_COOKIE_NAME,
} from "../src/security/session.mjs";
import { hashPassword, verifyPassword } from "../src/security/password.mjs";

test("session tokens are opaque, high-entropy format values and only hashes are persisted", () => {
  const first = createSessionToken();
  const second = createSessionToken();

  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.isBuffer(first.tokenHash), true);
  assert.equal(first.tokenHash.length, 32);
  assert.deepEqual(first.tokenHash, hashSessionToken(first.token));
  assert.notEqual(first.token, second.token);
  assert.notDeepEqual(first.tokenHash, second.tokenHash);
  assert.throws(() => hashSessionToken("short"), /invalid format/);
});

test("session cookie is host-only, secure, HttpOnly and rejects duplicate names", () => {
  const { token } = createSessionToken();
  const cookie = serializeSessionCookie(token, { maxAgeSeconds: 3600 });

  assert.match(cookie, new RegExp("^" + SESSION_COOKIE_NAME));
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; SameSite=Lax/);
  assert.match(cookie, /; Max-Age=3600$/);
  assert.equal(cookie.includes("Domain="), false);
  assert.equal(readSessionCookie(cookie), token);
  assert.equal(readSessionCookie("other=value"), null);
  assert.equal(readSessionCookie(cookie + "; " + cookie.split(";")[0]), null);
  assert.equal(readSessionCookie("x".repeat(8193)), null);
  assert.throws(() => serializeSessionCookie(token, { maxAgeSeconds: 0 }), /maxAgeSeconds/);
  assert.throws(() => serializeSessionCookie(token, { maxAgeSeconds: 604801 }), /maxAgeSeconds/);
});

test("cleared session cookie expires the host-only session", () => {
  const cookie = serializeClearedSessionCookie();
  assert.match(cookie, new RegExp("^" + SESSION_COOKIE_NAME + "="));
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; SameSite=Lax/);
  assert.match(cookie, /; Max-Age=0$/);
  assert.equal(cookie.includes("Domain="), false);
});

test("password verifier hashes and verifies without storing plaintext", async () => {
  const candidate = "Synthetic-Password-2026!";
  const verifier = await hashPassword(candidate);

  assert.notEqual(verifier, candidate);
  assert.match(verifier, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword(candidate, verifier), true);
  assert.equal(await verifyPassword("Different-Password-2026!", verifier), false);
  assert.equal(await verifyPassword(candidate, "not-a-verifier"), false);
});

test("password hashing rejects values outside the configured byte limits", async () => {
  await assert.rejects(() => hashPassword("short"), /between 12 and 1024 UTF-8 bytes/);
  await assert.rejects(() => hashPassword("x".repeat(1025)), /between 12 and 1024 UTF-8 bytes/);
});
