import assert from "node:assert/strict";
import test from "node:test";

import { createAuthenticationService } from "./authentication.mjs";
import { hashSessionToken } from "./session.mjs";

function makeFixture({ user, blocked = false, failedBlocked = false, dbFailure = false } = {}) {
  const events = [];
  const queries = [];
  const verifications = [];
  let released = false;
  const rateLimiter = {
    async isBlocked(input) { events.push(["blocked", input]); return blocked; },
    async recordFailure(input) { events.push(["failure", input]); return { blocked: failedBlocked }; },
    async clearAccountFailures(input) { events.push(["clear", input]); },
  };
  const client = {
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (dbFailure && sql.includes("INSERT INTO audit_events")) throw new Error("audit failure");
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("INSERT INTO auth_sessions")) return { rows: [{ expires_at: "2030-01-01T00:00:00.000Z" }] };
      if (sql.includes("INSERT INTO audit_events")) return { rows: [] };
      throw new Error("Unexpected transactional query");
    },
    release() { released = true; },
  };
  const pool = {
    async query(sql, values) {
      events.push(["lookup", values]);
      return { rows: user ? [user] : [] };
    },
    async connect() { return client; },
  };
  return { service: createAuthenticationService({
    pool, rateLimiter, verify: async (password, encoded) => {
      verifications.push({ password, encoded });
      return password === "CorrectHorseBatteryStaple!" && encoded === "test-hash";
    },
  }), events, queries, verifications, get released() { return released; } };
}

test("successful login issues one opaque session and audits it transactionally", async () => {
  const f = makeFixture({ user: { id: "user-uuid", password_hash: "test-hash", account_status: "active" } });
  const result = await f.service.authenticate({
    email: " PERSON@example.org ", password: ["CorrectHorse", "BatteryStaple!"].join(""), clientAddress: "203.0.113.10",
  });
  assert.equal(result.ok, true);
  assert.equal(typeof result.token, "string");
  assert.equal(result.token.length, 43);
  assert.equal(f.queries[1].sql.includes("INSERT INTO auth_sessions"), true);
  assert.deepEqual(f.queries[1].values[1], hashSessionToken(result.token));
  assert.equal(f.queries[2].sql.includes("auth.login_succeeded"), true);
  assert.equal(f.queries.at(-1).sql, "COMMIT");
  assert.deepEqual(f.events[0][1], { email: "person@example.org", clientAddress: "203.0.113.10" });
  assert.equal(f.events.some(([type]) => type === "clear"), true);
  assert.equal(f.released, true);
});

test("unknown, inactive and incorrect-password accounts receive the same public result", async () => {
  const cases = [
    makeFixture({ user: null }),
    makeFixture({ user: { id: "user-uuid", password_hash: "test-hash", account_status: "pending" } }),
    makeFixture({ user: { id: "user-uuid", password_hash: "test-hash", account_status: "active" } }),
  ];
  for (const f of cases) {
    const result = await f.service.authenticate({
      email: "person@example.org", password: ["wrong", "-password"].join(""), clientAddress: "203.0.113.10",
    });
    assert.deepEqual(result, { ok: false, reason: "invalid_credentials" });
    assert.equal(f.queries.length, 0);
    assert.equal(f.events.some(([type]) => type === "failure"), true);
    assert.equal(f.verifications.length, 1);
    assert.equal(f.released, false);
  }
  assert.match(cases[0].verifications[0].encoded, /^scrypt\\$32768\\$8\\$1\\$/);
});

test("blocked account is rejected before password lookup", async () => {
  const f = makeFixture({ blocked: true, user: { id: "u", password_hash: "test-hash", account_status: "active" } });
  const result = await f.service.authenticate({
    email: "person@example.org", password: ["CorrectHorse", "BatteryStaple!"].join(""), clientAddress: "203.0.113.10",
  });
  assert.deepEqual(result, { ok: false, reason: "temporarily_blocked" });
  assert.equal(f.events.some(([type]) => type === "lookup"), false);
});

test("session is rolled back if the audit record cannot be written", async () => {
  const f = makeFixture({
    user: { id: "user-uuid", password_hash: "test-hash", account_status: "active" },
    dbFailure: true,
  });
  await assert.rejects(() => f.service.authenticate({
    email: "person@example.org", password: ["CorrectHorse", "BatteryStaple!"].join(""), clientAddress: "203.0.113.10",
  }), /audit failure/);
  assert.equal(f.queries.at(-1).sql, "ROLLBACK");
  assert.equal(f.released, true);
});

test("invalid inputs fail before database or rate-limit operations", async () => {
  const f = makeFixture();
  const result = await f.service.authenticate({ email: "bad", password: "x", clientAddress: "203.0.113.10" });
  assert.deepEqual(result, { ok: false, reason: "invalid_credentials" });
  assert.equal(f.events.length, 0);
});
