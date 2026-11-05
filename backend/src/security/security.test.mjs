import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionToken,
  hashSessionToken,
  readSessionCookie,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  SESSION_COOKIE_NAME,
} from "./session.mjs";
import { hashPassword, verifyPassword } from "./password.mjs";
import { createPrincipalResolver } from "./principal.mjs";
import { isAuthorized, isValidPrincipal } from "./authorization.mjs";

test("session tokens are random opaque values and only their digest is suitable for storage", () => {
  const first = createSessionToken();
  const second = createSessionToken();

  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(first.token.length, 43);
  assert.equal(first.tokenHash.length, 32);
  assert.notEqual(first.token, second.token);
  assert.notDeepEqual(first.tokenHash, Buffer.from(first.token));
  assert.deepEqual(first.tokenHash, hashSessionToken(first.token));
  assert.throws(() => hashSessionToken("short"), /invalid format/i);
});

test("session cookie is host-only, secure, HttpOnly and rejects duplicate or malformed cookies", () => {
  const { token } = createSessionToken();
  const cookie = serializeSessionCookie(token, { maxAgeSeconds: 3600 });

  assert.match(cookie, new RegExp("^" + SESSION_COOKIE_NAME));
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; SameSite=Lax/);
  assert.match(cookie, /; Max-Age=3600/);
  assert.doesNotMatch(cookie, /; Domain=/);
  assert.equal(readSessionCookie(cookie), token);
  assert.equal(readSessionCookie(cookie + "; " + SESSION_COOKIE_NAME + "=" + token), null);
  assert.equal(readSessionCookie(SESSION_COOKIE_NAME + "=bad"), null);
  assert.equal(readSessionCookie("other=value"), null);
  assert.equal(readSessionCookie("x".repeat(8193)), null);
  assert.match(serializeClearedSessionCookie(), /; Max-Age=0/);
  assert.throws(() => serializeSessionCookie(token, { maxAgeSeconds: 0 }), /maxAgeSeconds/i);
});

test("password verifier accepts only the original password and rejects malformed input", async () => {
  const password = ["Example", "only", "passphrase", "2026"].join("-");
  const encoded = await hashPassword(password);

  assert.match(encoded, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword(["Example", "only", "passphrase", "2026?"].join("-"), encoded), false);
  assert.equal(await verifyPassword(password, "not-a-verifier"), false);
  assert.equal(await verifyPassword("x".repeat(1025), encoded), false);
  await assert.rejects(() => hashPassword("short"), /between 12 and 1024/i);
});

test("principal resolver hashes cookie token and never trusts client-supplied identity headers", async () => {
  const { token } = createSessionToken();
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      return {
        rows: [{
          id: "00000000-0000-4000-8000-000000000001",
          account_status: "active",
          role_code: "case_worker",
          scope_type: "global",
          scope_id: null,
        }],
      };
    },
  };
  const resolvePrincipal = createPrincipalResolver({ pool });
  const principal = await resolvePrincipal({
    headers: {
      cookie: serializeSessionCookie(token, { maxAgeSeconds: 3600 }),
      "x-user-id": "attacker-controlled",
      "x-role": "administrator",
    },
  });

  assert.equal(principal.id, "00000000-0000-4000-8000-000000000001");
  assert.deepEqual(principal.grants, [{
    roleCode: "case_worker",
    scopeType: "global",
  }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].values.length, 1);
  assert.deepEqual(calls[0].values[0], hashSessionToken(token));
  assert.doesNotMatch(calls[0].sql, /x-user-id|x-role/i);
});

test("principal resolver fails closed for absent or invalid session cookies", async () => {
  let calls = 0;
  const resolvePrincipal = createPrincipalResolver({
    pool: { async query() { calls += 1; return { rows: [] }; } },
  });

  assert.equal(await resolvePrincipal({ headers: {} }), null);
  assert.equal(await resolvePrincipal({ headers: { cookie: SESSION_COOKIE_NAME + "=invalid" } }), null);
  assert.equal(calls, 0);
});

test("authorization is scoped to the authenticated principal and fails closed", () => {
  const applicant = {
    id: "applicant-1",
    accountStatus: "active",
    grants: [{ roleCode: "applicant", scopeType: "global" }],
  };

  assert.equal(isValidPrincipal(applicant), true);
  assert.equal(isAuthorized({
    principal: applicant,
    permission: "applications:read",
    resource: { applicantId: "applicant-1" },
  }), true);
  assert.equal(isAuthorized({
    principal: applicant,
    permission: "applications:read",
    resource: { applicantId: "another-applicant" },
  }), false);
  assert.equal(isAuthorized({
    principal: { ...applicant, accountStatus: "suspended" },
    permission: "applications:read",
    resource: { applicantId: "applicant-1" },
  }), false);
  assert.equal(isAuthorized({
    principal: applicant,
    permission: "users:manage",
  }), false);
  assert.equal(isAuthorized({
    principal: applicant,
    permission: "unknown:permission",
  }), false);
  assert.equal(isAuthorized({
    principal: applicant,
    permission: "applications:read",
    resource: null,
  }), false);
});
