import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionToken,
  hashSessionToken,
  readSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from "../src/security/session.mjs";

test("session tokens are high-entropy opaque values and only hashes are intended for storage", () => {
  const first = createSessionToken();
  const second = createSessionToken();
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.token, second.token);
  assert.equal(first.tokenHash.length, 32);
  assert.deepEqual(first.tokenHash, hashSessionToken(first.token));
  assert.notEqual(first.token, first.tokenHash.toString("hex"));
});

test("session cookie has host-only secure attributes", () => {
  const { token } = createSessionToken();
  const cookie = serializeSessionCookie(token, { maxAgeSeconds: 3600 });
  assert.match(cookie, /^__Host-userdie_session=/);
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; SameSite=Lax/);
  assert.match(cookie, /; Max-Age=3600$/);
  assert.equal(cookie.includes("Domain="), false);
});

test("cookie reader rejects absent, malformed, oversized and duplicate cookies", () => {
  const { token } = createSessionToken();
  const valid = `__Host-userdie_session=${token}`;
  assert.equal(readSessionCookie(valid), token);
  assert.equal(readSessionCookie(`other=value; ${valid}`), token);
  assert.equal(readSessionCookie(""), null);
  assert.equal(readSessionCookie("__Host-userdie_session=not-a-token"), null);
  assert.equal(readSessionCookie(`${valid}; ${valid}`), null);
  assert.equal(readSessionCookie("x".repeat(8193)), null);
});

test("cookie expiry is bounded and logout cookie clears the same host-only cookie", () => {
  const { token } = createSessionToken();
  assert.throws(() => serializeSessionCookie(token, { maxAgeSeconds: 0 }), RangeError);
  assert.throws(() => serializeSessionCookie(token, { maxAgeSeconds: 604801 }), RangeError);
  const cleared = serializeClearedSessionCookie();
  assert.match(cleared, /^__Host-userdie_session=;/);
  assert.match(cleared, /; Max-Age=0$/);
  assert.match(cleared, /; Secure/);
});

test("token hashing rejects invalid input", () => {
  assert.throws(() => hashSessionToken(""), TypeError);
  assert.throws(() => hashSessionToken("bearer-token"), TypeError);
});
