import assert from "node:assert/strict";
import test from "node:test";
import { createAccountRecoveryService } from "./account-recovery.mjs";

function fixture({ user = null } = {}) {
  const calls = [];
  const delivered = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("INSERT INTO auth_recovery_tokens")) return { rows: [{ id: "42" }] };
      if (sql.includes("SELECT recovery.id")) return { rows: [{ id: "42", user_id: "user-uuid" }] };
      return { rows: [], rowCount: 1 };
    },
    release() { calls.push({ sql: "RELEASE" }); },
  };
  const pool = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      return { rows: user ? [user] : [] };
    },
    async connect() { return client; },
  };
  return {
    calls, delivered,
    service: createAccountRecoveryService({
      pool,
      sendRecoveryMessage: async (message) => delivered.push(message),
    }),
  };
}

test("recovery request returns the same generic result for unknown accounts", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.request({ email: "missing@example.org" }), { accepted: true });
  assert.equal(f.delivered.length, 0);
  assert.equal(f.calls.some((call) => call.sql === "BEGIN"), false);
});

test("recovery request stores only a digest and sends raw token only to the delivery adapter", async () => {
  const f = fixture({ user: { id: "user-uuid", email: "person@example.org", account_status: "active" } });
  const result = await f.service.request({ email: "PERSON@example.org" });
  assert.deepEqual(result, { accepted: true });
  assert.equal(f.delivered.length, 1);
  assert.equal(f.delivered[0].email, "person@example.org");
  assert.match(f.delivered[0].token, /^[A-Za-z0-9_-]{43}$/);
  const insert = f.calls.find((call) => call.sql.includes("INSERT INTO auth_recovery_tokens"));
  assert.ok(Buffer.isBuffer(insert.values[1]));
  assert.notEqual(insert.values[1].toString("base64url"), f.delivered[0].token);
  assert.equal(f.calls.some((call) => call.sql.includes("auth.recovery_requested")), true);
  assert.equal(JSON.stringify(result).includes(f.delivered[0].token), false);
});

test("valid recovery email is trimmed, lowercased, and queried without rejecting its dot separator", async () => {
  const f = fixture({ user: { id: "user-uuid", email: "person.name+tag@example.org", account_status: "active" } });
  await f.service.request({ email: "  PERSON.NAME+TAG@EXAMPLE.ORG  " });
  const lookup = f.calls.find((call) => call.sql.includes("SELECT id, email FROM app_users"));
  assert.deepEqual(lookup.values, ["person.name+tag@example.org"]);
  assert.equal(f.delivered.length, 1);
});

test("malformed recovery email is rejected before database access", async () => {
  for (const email of ["plain-address", "missing-domain@", "missing-dot@example", "has space@example.org"]) {
    const f = fixture();
    assert.deepEqual(await f.service.request({ email }), { accepted: true });
    assert.equal(f.calls.length, 0, `database should not be queried for ${email}`);
    assert.equal(f.delivered.length, 0);
  }
});

test("invalid or weak reset input fails before database access", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.consume({ token: "invalid", newPassword: "short" }), { reset: false });
  assert.equal(f.calls.length, 0);
});


function consumeFixture({ recovery = { id: "42", user_id: "user-uuid" }, failAt = null } = {}) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("SELECT recovery.id")) return { rows: recovery ? [recovery] : [] };
      if (failAt && sql.includes(failAt)) throw new Error("synthetic database failure");
      return { rows: [], rowCount: 1 };
    },
    release() { calls.push({ sql: "RELEASE" }); },
  };
  const pool = {
    async query() { return { rows: [] }; },
    async connect() { return client; },
  };
  return {
    calls,
    service: createAccountRecoveryService({
      pool,
      sendRecoveryMessage: async () => {},
    }),
  };
}

test("valid recovery token resets password, consumes token, revokes sessions and audits atomically", async () => {
  const f = consumeFixture();
  const rawToken = "A".repeat(43);
  const newPassword = "correct horse battery staple";
  assert.deepEqual(
    await f.service.consume({ token: rawToken, newPassword }),
    { reset: true },
  );

  const passwordUpdate = f.calls.find((call) => call.sql.includes("UPDATE app_users SET password_hash"));
  assert.ok(passwordUpdate);
  assert.match(passwordUpdate.values[0], /^scrypt\$32768\$8\$1\$/);
  assert.notEqual(passwordUpdate.values[0], newPassword);
  assert.equal(passwordUpdate.values[1], "user-uuid");
  assert.equal(f.calls.some((call) => call.sql.includes("UPDATE auth_recovery_tokens SET consumed_at")), true);
  assert.equal(f.calls.some((call) => call.sql.includes("UPDATE auth_sessions") && call.values[0] === "user-uuid"), true);
  assert.equal(f.calls.some((call) => call.sql.includes("auth.password_reset_completed")), true);
  assert.equal(f.calls.at(-2).sql, "COMMIT");
  assert.equal(f.calls.at(-1).sql, "RELEASE");
  assert.equal(JSON.stringify(f.calls).includes(rawToken), false);
  assert.equal(JSON.stringify(f.calls).includes(newPassword), false);
});

test("expired, consumed, replayed or unknown recovery tokens fail without changing credentials", async () => {
  const f = consumeFixture({ recovery: null });
  const result = await f.service.consume({
    token: "B".repeat(43),
    newPassword: "correct horse battery staple",
  });
  assert.deepEqual(result, { reset: false });
  assert.equal(f.calls.some((call) => call.sql.includes("UPDATE app_users SET password_hash")), false);
  assert.equal(f.calls.some((call) => call.sql.includes("UPDATE auth_sessions")), false);
  assert.equal(f.calls.at(-2).sql, "ROLLBACK");
  assert.equal(f.calls.at(-1).sql, "RELEASE");
});

test("database failure during password reset rolls back and releases the connection", async () => {
  const f = consumeFixture({ failAt: "UPDATE auth_sessions" });
  await assert.rejects(
    f.service.consume({
      token: "C".repeat(43),
      newPassword: "correct horse battery staple",
    }),
    /synthetic database failure/,
  );
  assert.equal(f.calls.at(-2).sql, "ROLLBACK");
  assert.equal(f.calls.at(-1).sql, "RELEASE");
});
