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

test("invalid or weak reset input fails before database access", async () => {
  const f = fixture();
  assert.deepEqual(await f.service.consume({ token: "invalid", newPassword: "short" }), { reset: false });
  assert.equal(f.calls.length, 0);
});
