import assert from "node:assert/strict";
import test from "node:test";

import { rotateSession } from "./session-lifecycle.mjs";
import { createSessionToken, hashSessionToken } from "./session.mjs";

function fixture({ active = true, failAudit = false } = {}) {
  const calls = [];
  let released = false;
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("UPDATE auth_sessions")) {
        return { rows: active ? [{ user_id: "user-uuid" }] : [] };
      }
      if (sql.includes("INSERT INTO auth_sessions")) {
        return { rows: [{ id: "42", expires_at: "2030-01-01T00:00:00.000Z" }] };
      }
      if (sql.includes("INSERT INTO audit_events")) {
        if (failAudit) throw new Error("audit unavailable");
        return { rows: [] };
      }
      throw new Error("Unexpected SQL");
    },
    release() { released = true; },
  };
  return {
    calls,
    client,
    get released() { return released; },
    pool: { async connect() { return client; } },
  };
}

test("rotation revokes the old digest, stores a new digest and audits in one transaction", async () => {
  const f = fixture();
  const { token } = createSessionToken();
  const result = await rotateSession({ pool: f.pool, token, maxAgeSeconds: 1800 });

  assert.equal(typeof result.token, "string");
  assert.notEqual(result.token, token);
  assert.equal(result.expiresAt, "2030-01-01T00:00:00.000Z");
  assert.deepEqual(f.calls.map((call) => call.sql), [
    "BEGIN",
    f.calls[1].sql,
    f.calls[2].sql,
    f.calls[3].sql,
    "COMMIT",
  ]);
  assert.match(f.calls[1].sql, /revoked_at = now\(\)/);
  assert.deepEqual(f.calls[1].values[0], hashSessionToken(token));
  assert.equal(Buffer.isBuffer(f.calls[2].values[1]), true);
  assert.equal(f.calls[2].values[1].length, 32);
  assert.deepEqual(f.calls[2].values.slice(0, 1), ["user-uuid"]);
  assert.match(f.calls[3].sql, /auth\.session_rotated/);
  assert.equal(f.released, true);
});

test("rotation fails closed for an unknown, expired or already revoked token", async () => {
  const f = fixture({ active: false });
  const { token } = createSessionToken();
  assert.equal(await rotateSession({ pool: f.pool, token }), null);
  assert.deepEqual(f.calls.map((call) => call.sql), ["BEGIN", f.calls[1].sql, "ROLLBACK"]);
  assert.equal(f.calls.some((call) => call.sql.includes("INSERT INTO auth_sessions")), false);
  assert.equal(f.released, true);
});

test("audit failure rolls back both sides of a rotation", async () => {
  const f = fixture({ failAudit: true });
  const { token } = createSessionToken();
  await assert.rejects(() => rotateSession({ pool: f.pool, token }), /audit unavailable/);
  assert.equal(f.calls.at(-1).sql, "ROLLBACK");
  assert.equal(f.released, true);
});

test("rotation rejects unsafe lifetime and malformed tokens without database writes", async () => {
  const f = fixture();
  const { token } = createSessionToken();
  await assert.rejects(() => rotateSession({ pool: f.pool, token, maxAgeSeconds: 0 }), /maxAgeSeconds/);
  assert.equal(await rotateSession({ pool: f.pool, token: "malformed" }), null);
  assert.equal(f.calls.length, 0);
});
