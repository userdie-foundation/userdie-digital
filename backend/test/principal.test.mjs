import test from "node:test";
import assert from "node:assert/strict";
import { createSessionToken } from "../src/security/session.mjs";
import { createPrincipalResolver } from "../src/security/principal.mjs";

test("principal resolver does not query storage without exactly one valid session cookie", async () => {
  let calls = 0;
  const resolve = createPrincipalResolver({ pool: { async query() { calls += 1; return { rows: [] }; } } });
  assert.equal(await resolve({ headers: {} }), null);
  assert.equal(await resolve({ headers: { cookie: "__Host-userdie_session=invalid" } }), null);
  assert.equal(await resolve({ headers: { cookie: "x=1; __Host-userdie_session=invalid; __Host-userdie_session=invalid" } }), null);
  assert.equal(calls, 0);
});

test("principal resolver hashes the opaque cookie token and loads trusted global and scoped grants", async () => {
  const { token, tokenHash } = createSessionToken();
  let queryArgs;
  const resolve = createPrincipalResolver({
    pool: {
      async query(sql, args) {
        assert.match(sql, /s\.revoked_at IS NULL/);
        assert.match(sql, /s\.expires_at > now\(\)/);
        assert.match(sql, /u\.account_status = 'active'/);
        queryArgs = args;
        return { rows: [
          { id: "user-1", account_status: "active", role_code: "case_worker", scope_type: "global", scope_id: null },
          { id: "user-1", account_status: "active", role_code: "program_manager", scope_type: "program", scope_id: "program-7" },
          { id: "user-1", account_status: "active", role_code: "program_manager", scope_type: "program", scope_id: "program-7" },
        ] };
      },
    },
  });

  const principal = await resolve({ headers: { cookie: `__Host-userdie_session=${token}` } });
  assert.equal(Buffer.isBuffer(queryArgs[0]), true);
  assert.deepEqual(queryArgs[0], tokenHash);
  assert.deepEqual(principal, {
    id: "user-1",
    accountStatus: "active",
    grants: [
      { roleCode: "case_worker", scopeType: "global" },
      { roleCode: "program_manager", scopeType: "program", scopeId: "program-7" },
    ],
  });
});

test("principal resolver fails closed when the session is absent, expired, revoked, or account inactive", async () => {
  const { token } = createSessionToken();
  const resolve = createPrincipalResolver({ pool: { async query() { return { rows: []; } } } });
  assert.equal(await resolve({ headers: { cookie: `__Host-userdie_session=${token}` } }), null);
});
