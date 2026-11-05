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

async function invokeLogout(options = {}) {
  const origin = Object.hasOwn(options, "origin") ? options.origin : "https://foundation.example";
  const { cookie, queryError } = options;
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
    headers: { ...(origin === null ? {} : { origin }), ...(cookie ? { cookie } : {}) },
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


async function invokeLogin({ origin = "https://foundation.example", contentType = "application/json", body, authResult, serviceError } = {}) {
  const calls = [];
  const pool = { async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; } };
  const authenticationService = {
    async authenticate(input) {
      calls.push({ authentication: input });
      if (serviceError) throw serviceError;
      return authResult;
    },
  };
  const handler = createServer({ pool, allowedOrigin: "https://foundation.example", authenticationService });
  const req = {
    method: "POST",
    url: "/api/v1/auth/login",
    headers: { ...(origin === null ? {} : { origin }), "content-type": contentType },
    socket: { remoteAddress: "203.0.113.10" },
    async *[Symbol.asyncIterator]() { yield Buffer.from(body ?? JSON.stringify({
      email: "person@example.org", password: ["CorrectHorse", "BatteryStaple!"].join(""),
    })); },
  };
  const res = responseRecorder();
  await handler(req, res);
  return { calls, res };
}

test("login requires exact same origin and never calls authentication for a foreign origin", async () => {
  const { calls, res } = await invokeLogin({ origin: "https://attacker.example" });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

test("login issues secure HttpOnly cookie and returns no bearer token in JSON", async () => {
  const { token } = createSessionToken();
  const { calls, res } = await invokeLogin({
    authResult: { ok: true, token, expiresAt: "2030-01-01T00:00:00.000Z" },
  });
  assert.equal(res.status, 200);
  assert.equal(calls[0].authentication.clientAddress, "203.0.113.10");
  assert.match(res.headers["Set-Cookie"], /; HttpOnly/);
  assert.match(res.headers["Set-Cookie"], /; Secure/);
  assert.match(res.headers["Set-Cookie"], /; SameSite=Lax/);
  assert.equal(res.body.includes(token), false);
  assert.deepEqual(JSON.parse(res.body), {
    authenticated: true, expiresAt: "2030-01-01T00:00:00.000Z",
  });
});

test("login uses a generic credentials response and throttling status", async () => {
  const invalid = await invokeLogin({ authResult: { ok: false, reason: "invalid_credentials" } });
  assert.equal(invalid.res.status, 401);
  assert.deepEqual(JSON.parse(invalid.res.body), { error: "invalid_credentials" });
  const blocked = await invokeLogin({ authResult: { ok: false, reason: "temporarily_blocked" } });
  assert.equal(blocked.res.status, 429);
});

test("login rejects unsupported media type, malformed body and extra fields", async () => {
  const unsupported = await invokeLogin({ contentType: "text/plain" });
  assert.equal(unsupported.res.status, 415);
  const malformed = await invokeLogin({ body: "not-json" });
  assert.equal(malformed.res.status, 400);
  const extra = await invokeLogin({ body: JSON.stringify({
    email: "person@example.org", password: "pass", role: "administrator",
  }) });
  assert.equal(extra.res.status, 400);
  assert.equal(extra.calls.length, 0);
});

test("login returns service unavailable without leaking authentication errors", async () => {
  const { res } = await invokeLogin({ serviceError: new Error("database credentials must not leak") });
  assert.equal(res.status, 503);
  assert.equal(res.body.includes("credentials must not leak"), false);
});


async function invokeRotate({ origin = "https://foundation.example", cookie, active = true, failAudit = false } = {}) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("UPDATE auth_sessions")) return { rows: active ? [{ user_id: "user-uuid" }] : [] };
      if (sql.includes("INSERT INTO auth_sessions")) {
        return { rows: [{ id: "session-2", expires_at: "2030-01-01T00:00:00.000Z" }] };
      }
      if (sql.includes("INSERT INTO audit_events")) {
        if (failAudit) throw new Error("audit unavailable");
        return { rows: [] };
      }
      throw new Error("Unexpected SQL");
    },
    release() { calls.push({ released: true }); },
  };
  const pool = {
    async query() { throw new Error("Unexpected pool-level query"); },
    async connect() { calls.push({ connected: true }); return client; },
  };
  const handler = createServer({ pool, allowedOrigin: "https://foundation.example" });
  const req = {
    method: "POST",
    url: "/api/v1/auth/rotate",
    headers: { ...(origin === null ? {} : { origin }), ...(cookie ? { cookie } : {}) },
  };
  const res = responseRecorder();
  await handler(req, res);
  return { calls, res };
}

test("session rotation replaces the cookie and returns no bearer token in JSON", async () => {
  const { token } = createSessionToken();
  const { calls, res } = await invokeRotate({
    cookie: serializeSessionCookie(token, { maxAgeSeconds: 3600 }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers["Set-Cookie"], /; HttpOnly/);
  assert.match(res.headers["Set-Cookie"], /; Secure/);
  assert.match(res.headers["Set-Cookie"], /; SameSite=Lax/);
  assert.notEqual(res.headers["Set-Cookie"].split(";")[0].split("=")[1], token);
  assert.equal(res.body.includes(token), false);
  assert.deepEqual(JSON.parse(res.body), {
    authenticated: true, expiresAt: "2030-01-01T00:00:00.000Z",
  });
  assert.deepEqual(calls[2].values[0], hashSessionToken(token));
  assert.equal(calls.at(-2).sql, "COMMIT");
  assert.deepEqual(calls.at(-1), { released: true });
});

test("session rotation rejects foreign origins and missing cookies without database access", async () => {
  const { token } = createSessionToken();
  for (const options of [
    { origin: "https://attacker.example", cookie: serializeSessionCookie(token, { maxAgeSeconds: 3600 }) },
    { cookie: undefined },
  ]) {
    const { calls, res } = await invokeRotate(options);
    assert.equal(res.status, options.origin ? 403 : 401);
    assert.equal(calls.length, 0);
  }
});

test("session rotation clears an expired or revoked cookie and does not issue a replacement", async () => {
  const { token } = createSessionToken();
  const { calls, res } = await invokeRotate({
    active: false,
    cookie: serializeSessionCookie(token, { maxAgeSeconds: 3600 }),
  });
  assert.equal(res.status, 401);
  assert.match(res.headers["Set-Cookie"], /; Max-Age=0/);
  assert.equal(calls.some((call) => call.sql?.includes("INSERT INTO auth_sessions")), false);
  assert.equal(calls.at(-2).sql, "ROLLBACK");
});

test("session rotation fails closed when its audit event cannot be persisted", async () => {
  const { token } = createSessionToken();
  const { calls, res } = await invokeRotate({
    failAudit: true,
    cookie: serializeSessionCookie(token, { maxAgeSeconds: 3600 }),
  });
  assert.equal(res.status, 503);
  assert.equal(res.headers["Set-Cookie"], undefined);
  assert.equal(calls.at(-2).sql, "ROLLBACK");
});
