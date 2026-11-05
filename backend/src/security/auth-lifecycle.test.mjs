import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "../server.mjs";
import { createSessionToken, hashSessionToken, SESSION_COOKIE_NAME, serializeSessionCookie } from "./session.mjs";

function responseRecorder() {
  return {
    headers: {},
    status: null,
    body: "",
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    end(body = "") { this.body = body; },
  };
}

async function invokeLogout({ origin = "https://foundation.example", cookie, queryError } = {}) {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (queryError) throw queryError;
      return { rows: [], rowCount: 1 };
    },
  };
  const handler = createServer({ pool, allowedOrigin: "https://foundation.example" });
  const req = {
    method: "POST",
    url: "/api/v1/auth/logout",
    headers: { origin, ...(cookie ? { cookie } : {}) },
  };
  const res = responseRecorder();
  await handler(req, res);
  return { calls, res };
}

test("logout revokes the hashed session before clearing the secure cookie", async () => {
  const { token } = createSessionToken();
  const { calls, res } = await invokeLogout({
    cookie: serializeSessionCookie(token, { maxAgeSeconds: 3600 }),
  });

  assert.equal(res.status, 204);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE auth_sessions SET revoked_at = now\(\)/);
  assert.match(calls[0].sql, /revoke_reason = 'user_logout'/);
  assert.deepEqual(calls[0].values[0], hashSessionToken(token));
  assert.equal(res.headers["Set-Cookie"].startsWith(SESSION_COOKIE_NAME + "="), true);
  assert.match(res.headers["Set-Cookie"], /; Max-Age=0/);
  assert.match(res.headers["Set-Cookie"], /; HttpOnly/);
  assert.match(res.headers["Set-Cookie"], /; Secure/);
});

test("logout rejects a missing or mismatched Origin without touching sessions", async () => {
  for (const origin of [undefined, "https://attacker.example"]) {
    const { calls, res } = await invokeLogout({ origin });
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0);
    assert.equal(res.headers["Set-Cookie"], undefined);
  }
});

test("logout does not clear the cookie when server-side revocation fails", async () => {
  const { token } = createSessionToken();
  const { calls, res } = await invokeLogout({
    cookie: serializeSessionCookie(token, { maxAgeSeconds: 3600 }),
    queryError: new Error("database unavailable"),
  });

  assert.equal(calls.length, 1);
  assert.equal(res.status, 503);
  assert.equal(res.headers["Set-Cookie"], undefined);
});

test("logout clears an absent or malformed browser cookie without a database write", async () => {
  for (const cookie of [undefined, SESSION_COOKIE_NAME + "=malformed"]) {
    const { calls, res } = await invokeLogout({ cookie });
    assert.equal(res.status, 204);
    assert.equal(calls.length, 0);
    assert.match(res.headers["Set-Cookie"], /; Max-Age=0/);
  }
});

test("logout endpoint rejects other methods", async () => {
  const pool = { async query() { throw new Error("must not be called"); } };
  const handler = createServer({ pool, allowedOrigin: "https://foundation.example" });
  const req = {
    method: "GET",
    url: "/api/v1/auth/logout",
    headers: { origin: "https://foundation.example" },
  };
  const res = responseRecorder();
  await handler(req, res);
  assert.equal(res.status, 405);
  assert.equal(res.headers.Allow, "POST");
});
