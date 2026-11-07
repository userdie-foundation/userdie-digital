import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import { createServer as createHandler } from "../src/server.mjs";

async function withServer(pool, run, options = {}) {
  const server = createHttpServer(createHandler({ pool, ...options }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

const grant = (roleCode, scopeType = "global", scopeId) => ({
  roleCode, scopeType, ...(scopeId ? { scopeId } : {}),
});
const identity = (id, roleCode, scopeType, scopeId, accountStatus = "active") => ({
  id, accountStatus, grants: [grant(roleCode, scopeType, scopeId)],
});
const records = [
  { id: "case-a", applicantId: "applicant-1", assignedTo: "worker-1", programId: "program-a", status: "in_review", subject: "Synthetic case A", sharedWithPrincipalIds: ["partner-1"] },
  { id: "case-b", applicantId: "applicant-2", assignedTo: "worker-2", programId: "program-b", status: "submitted", subject: "Synthetic case B", sharedWithPrincipalIds: [] },
];
const syntheticRepository = {
  async getById(id) { return records.find((record) => record.id === id) ?? null; },
};
const noDb = { query: async () => ({ rows: [] }) };

test("live endpoint returns minimal health information and security headers", async () => {
  await withServer({ query: async () => { throw new Error("should not query"); } }, async (base) => {
    const response = await fetch(`${base}/api/v1/health/live`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
    const head = await fetch(`${base}/api/v1/health/live`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  });
});

test("ready endpoint checks database connectivity without leaking errors", async () => {
  await withServer({ query: async () => ({ rows: [{ value: 1 }] }) }, async (base) => {
    const ready = await fetch(`${base}/api/v1/health/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: "ready" });
  });
  await withServer({ query: async () => { throw new Error("private connection details"); } }, async (base) => {
    const unavailable = await fetch(`${base}/api/v1/health/ready`);
    assert.equal(unavailable.status, 503);
    const body = await unavailable.text();
    assert.deepEqual(JSON.parse(body), { status: "unavailable" });
    assert.equal(body.includes("private"), false);
  });
});

test("all state-changing methods require the exact configured Origin before routing", async () => {
  await withServer(noDb, async (base) => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const missing = await fetch(base + "/api/v1/future-write", { method });
      assert.equal(missing.status, 403, method + " without Origin must be rejected");
      assert.deepEqual(await missing.json(), { error: "origin_not_allowed" });

      const foreign = await fetch(base + "/api/v1/future-write", {
        method, headers: { origin: "https://attacker.example" },
      });
      assert.equal(foreign.status, 403, method + " with foreign Origin must be rejected");
    }

    const sameOrigin = await fetch(base + "/api/v1/future-write", {
      method: "POST", headers: { origin: "https://platform.example" },
    });
    assert.equal(sameOrigin.status, 405);
    assert.deepEqual(await sameOrigin.json(), { error: "method_not_allowed" });

    const readWithoutOrigin = await fetch(base + "/api/v1/health/live");
    assert.equal(readWithoutOrigin.status, 200);
  }, { allowedOrigin: "https://platform.example" });
});

test("CORS allows only the configured exact origin", async () => {
  await withServer(noDb, async (base) => {
    const allowed = await fetch(`${base}/api/v1/health/live`, { headers: { origin: "https://platform.example" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://platform.example");
    const rejected = await fetch(`${base}/api/v1/health/live`, { headers: { origin: "https://attacker.example" } });
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  }, { allowedOrigin: "https://platform.example" });
});

test("logout revokes the server session and appends its audit event in one transaction", async () => {
  const calls = [];
  const pool = {
    async query() { return { rows: [] }; },
    async connect() {
      return {
        async query(sql, params) {
          calls.push({ sql, params });
          if (sql.includes("UPDATE auth_sessions")) {
            return { rows: [{ id: 42, user_id: "user-uuid" }] };
          }
          return { rows: [] };
        },
        release() { calls.push({ sql: "RELEASE" }); },
      };
    },
  };
  await withServer(pool, async (base) => {
    const response = await fetch(base + "/api/v1/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://platform.example",
        cookie: "__Host-userdie_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    });
    assert.equal(response.status, 204);
    assert.match(response.headers.get("set-cookie"), /Max-Age=0/);
  }, { allowedOrigin: "https://platform.example" });

  assert.equal(calls[0].sql, "BEGIN");
  assert.match(calls[1].sql, /UPDATE auth_sessions[\s\S]*RETURNING id, user_id/);
  assert.equal(calls[2].params[0], "user-uuid");
  assert.equal(calls[2].params[1], "42");
  assert.match(calls[2].sql, /auth\.session_revoked/);
  assert.deepEqual(JSON.parse(calls[2].params[2]), { reason: "user_logout" });
  assert.equal(calls[3].sql, "COMMIT");
  assert.equal(calls[4].sql, "RELEASE");
});

test("logout rolls back session revocation when its audit event cannot be written", async () => {
  const calls = [];
  const pool = {
    async query() { return { rows: [] }; },
    async connect() {
      return {
        async query(sql) {
          calls.push(sql);
          if (sql.includes("UPDATE auth_sessions")) {
            return { rows: [{ id: 42, user_id: "user-uuid" }] };
          }
          if (sql.includes("INSERT INTO audit_events")) throw new Error("private database detail");
          return { rows: [] };
        },
        release() { calls.push("RELEASE"); },
      };
    },
  };
  await withServer(pool, async (base) => {
    const response = await fetch(base + "/api/v1/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://platform.example",
        cookie: "__Host-userdie_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "session_service_unavailable" });
  }, { allowedOrigin: "https://platform.example" });
  assert.equal(calls.at(-2), "ROLLBACK");
  assert.equal(calls.at(-1), "RELEASE");
  assert.equal(calls.includes("COMMIT"), false);
  assert.equal(calls.some((sql) => String(sql).includes("private database detail")), false);
});

test("protected application route ignores client-supplied identity and fails closed by default", async () => {
  let repositoryCalls = 0;
  await withServer(noDb, async (base) => {
    const response = await fetch(`${base}/api/v1/applications/case-a`, {
      headers: { "x-user-id": "applicant-1", "x-role": "administrator", "x-scope": "global" },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
    assert.equal(repositoryCalls, 0);
  }, { applicationRepository: { async getById() { repositoryCalls += 1; return records[0]; } } });
});

test("applicant reads own record only; missing and forbidden records share 404", async () => {
  await withServer(noDb, async (base) => {
    const own = await fetch(`${base}/api/v1/applications/case-a`);
    assert.equal(own.status, 200);
    assert.deepEqual((await own.json()).application, {
      id: "case-a", programId: "program-a", status: "in_review", subject: "Synthetic case A",
    });
    const other = await fetch(`${base}/api/v1/applications/case-b`);
    const missing = await fetch(`${base}/api/v1/applications/not-found`);
    assert.equal(other.status, 404);
    assert.deepEqual(await other.json(), { error: "not_found" });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "not_found" });
  }, { resolvePrincipal: async () => identity("applicant-1", "applicant"), applicationRepository: syntheticRepository });
});

test("case worker is restricted to assigned records", async () => {
  await withServer(noDb, async (base) => {
    assert.equal((await fetch(`${base}/api/v1/applications/case-a`)).status, 200);
    assert.equal((await fetch(`${base}/api/v1/applications/case-b`)).status, 404);
  }, { resolvePrincipal: async () => identity("worker-1", "case_worker"), applicationRepository: syntheticRepository });
});

test("program manager is restricted to exact program scope", async () => {
  await withServer(noDb, async (base) => {
    assert.equal((await fetch(`${base}/api/v1/applications/case-a`)).status, 200);
    assert.equal((await fetch(`${base}/api/v1/applications/case-b`)).status, 404);
  }, { resolvePrincipal: async () => identity("manager-1", "program_manager", "program", "program-a"), applicationRepository: syntheticRepository });
});

test("partner can read explicitly shared records only", async () => {
  await withServer(noDb, async (base) => {
    assert.equal((await fetch(`${base}/api/v1/applications/case-a`)).status, 200);
    assert.equal((await fetch(`${base}/api/v1/applications/case-b`)).status, 404);
  }, { resolvePrincipal: async () => identity("partner-1", "partner"), applicationRepository: syntheticRepository });
});

test("auditor and administrator receive no implicit case access", async () => {
  for (const principal of [identity("auditor-1", "auditor"), identity("admin-1", "administrator")]) {
    await withServer(noDb, async (base) => {
      const response = await fetch(`${base}/api/v1/applications/case-a`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "not_found" });
    }, { resolvePrincipal: async () => principal, applicationRepository: syntheticRepository });
  }
});

test("inactive principal is denied before record lookup", async () => {
  let lookups = 0;
  await withServer(noDb, async (base) => {
    const response = await fetch(`${base}/api/v1/applications/case-a`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
    assert.equal(lookups, 0);
  }, {
    resolvePrincipal: async () => identity("worker-1", "case_worker", undefined, undefined, "suspended"),
    applicationRepository: { async getById() { lookups += 1; return records[0]; } },
  });
});

test("application collection stays disabled and all writes are rejected", async () => {
  let queries = 0;
  await withServer({ query: async () => { queries += 1; throw new Error("unexpected query"); } }, async (base) => {
    const list = await fetch(`${base}/api/v1/applications`);
    assert.equal(list.status, 503);
    assert.deepEqual(await list.json(), { error: "applications_module_unavailable" });
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await fetch(`${base}/api/v1/applications`, {
        method, headers: { origin: "https://platform.example", "content-type": "application/json" }, body: JSON.stringify({ subject: "synthetic" }),
      });
      assert.equal(response.status, 405);
      assert.deepEqual(await response.json(), { error: "method_not_allowed" });
    }
    assert.equal(queries, 0);
  }, { allowedOrigin: "https://platform.example" });
});

const programRecords = [
  {
    id: "program-a", code: "OPEN-WORLD", name: "Открытый мир",
    description: "Synthetic program record", status: "open",
    organizationalContour: "foundation", objective: "Synthetic objective",
    targetGroups: ["families"], geography: "Synthetic region",
    startsAt: null, endsAt: null,
    milestones: [
      { id: "milestone-a1", code: "M1", title: "Passport approval", description: "Synthetic milestone", status: "in_progress", dueAt: "2026-12-01T00:00:00.000Z", completedAt: null },
    ],
  },
  {
    id: "program-b", code: "HELP-SELF", name: "Помоги сам себе",
    description: "Second synthetic program", status: "draft",
    organizationalContour: "foundation", objective: "Synthetic objective",
    targetGroups: ["older_adults"], geography: "Synthetic region",
    startsAt: null, endsAt: null, milestones: [],
  },
];
const syntheticProgramRepository = {
  async getById(id) { return programRecords.find((program) => program.id === id) ?? null; },
};

test("program detail returns only its governed fields and milestones to an authorized scoped manager", async () => {
  await withServer(noDb, async (base) => {
    const response = await fetch(`${base}/api/v1/programs/program-a`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      program: {
        id: "program-a",
        code: "OPEN-WORLD",
        name: "Открытый мир",
        description: "Synthetic program record",
        status: "open",
        organizationalContour: "foundation",
        objective: "Synthetic objective",
        targetGroups: ["families"],
        geography: "Synthetic region",
        startsAt: null,
        endsAt: null,
        milestones: [
          { id: "milestone-a1", code: "M1", title: "Passport approval", description: "Synthetic milestone", status: "in_progress", dueAt: "2026-12-01T00:00:00.000Z", completedAt: null },
        ],
      },
    });
  }, {
    resolvePrincipal: async () => identity("manager-1", "program_manager", "program", "program-a"),
    programRepository: syntheticProgramRepository,
  });
});

test("program detail denies a manager outside their exact program scope", async () => {
  await withServer(noDb, async (base) => {
    const allowed = await fetch(`${base}/api/v1/programs/program-a`);
    const denied = await fetch(`${base}/api/v1/programs/program-b`);
    const missing = await fetch(`${base}/api/v1/programs/not-found`);
    assert.equal(allowed.status, 200);
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: "not_found" });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: "not_found" });
  }, {
    resolvePrincipal: async () => identity("manager-1", "program_manager", "program", "program-a"),
    programRepository: syntheticProgramRepository,
  });
});

test("program detail fails closed without trusted authentication and returns generic database errors", async () => {
  let lookups = 0;
  await withServer(noDb, async (base) => {
    const response = await fetch(`${base}/api/v1/programs/program-a`, {
      headers: { "x-user-id": "manager-1", "x-role": "administrator" },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
    assert.equal(lookups, 0);
  }, {
    programRepository: { async getById() { lookups += 1; return programRecords[0]; } },
  });

  await withServer(noDb, async (base) => {
    const response = await fetch(`${base}/api/v1/programs/program-a`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "programs_unavailable" });
  }, {
    resolvePrincipal: async () => identity("manager-1", "program_manager", "program", "program-a"),
    programRepository: { async getById() { throw new Error("private database details"); } },
  });
});

test("applicant program directory access is limited to open programs", async () => {
  await withServer(noDb, async (base) => {
    const openProgram = await fetch(`${base}/api/v1/programs/program-a`);
    const draftProgram = await fetch(`${base}/api/v1/programs/program-b`);
    assert.equal(openProgram.status, 200);
    assert.equal(draftProgram.status, 404);
    assert.deepEqual(await draftProgram.json(), { error: "not_found" });
  }, {
    resolvePrincipal: async () => identity("applicant-1", "applicant"),
    programRepository: syntheticProgramRepository,
  });
});

const syntheticWorkflowRepository = {
  async getByApplicationId(applicationId) {
    assert.equal(applicationId, "case-a");
    return {
      tasks: [
        {
          id: "task-a", title: "Verify supporting documents", status: "in_progress",
          priority: "high", assignedTo: "worker-1", dueAt: "2020-01-01T00:00:00.000Z",
          escalationLevel: 1, escalatedAt: "2020-01-02T00:00:00.000Z", completedAt: null,
        },
        {
          id: "task-b", title: "Close case", status: "completed",
          priority: "normal", assignedTo: "worker-1", dueAt: "2020-01-01T00:00:00.000Z",
          escalationLevel: 0, escalatedAt: null, completedAt: "2020-01-03T00:00:00.000Z",
        },
      ],
      events: [
        {
          id: 1, taskId: "task-a", type: "task_assigned", actorId: "manager-1",
          summary: "task_assigned", status: "in_progress", priority: "high",
          escalationLevel: 1, createdAt: "2020-01-02T00:00:00.000Z",
        },
      ],
    };
  },
};

test("case workflow returns task ownership, overdue state and audit timeline to assigned worker", async () => {
  await withServer(noDb, async (base) => {
    const response = await fetch(`${base}/api/v1/applications/case-a/workflow`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.applicationId, "case-a");
    assert.equal(body.tasks.length, 2);
    assert.equal(body.tasks[0].overdue, true);
    assert.equal(body.tasks[0].escalationLevel, 1);
    assert.equal(body.tasks[1].overdue, false);
    assert.equal(body.events[0].type, "task_assigned");
  }, {
    resolvePrincipal: async () => identity("worker-1", "case_worker"),
    applicationRepository: syntheticRepository,
    applicationWorkflowRepository: syntheticWorkflowRepository,
  });
});

test("case workflow is not visible to applicant or unassigned worker", async () => {
  for (const principal of [
    identity("applicant-1", "applicant"),
    identity("worker-2", "case_worker"),
  ]) {
    let workflowLookups = 0;
    await withServer(noDb, async (base) => {
      const response = await fetch(`${base}/api/v1/applications/case-a/workflow`);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "not_found" });
      assert.equal(workflowLookups, 0);
    }, {
      resolvePrincipal: async () => principal,
      applicationRepository: syntheticRepository,
      applicationWorkflowRepository: {
        async getByApplicationId() { workflowLookups += 1; return { tasks: [], events: [] }; },
      },
    });
  }
});

test("program manager can read workflow only inside exact program scope", async () => {
  await withServer(noDb, async (base) => {
    const allowed = await fetch(`${base}/api/v1/applications/case-a/workflow`);
    assert.equal(allowed.status, 200);
  }, {
    resolvePrincipal: async () => identity("manager-1", "program_manager", "program", "program-a"),
    applicationRepository: syntheticRepository,
    applicationWorkflowRepository: syntheticWorkflowRepository,
  });
  await withServer(noDb, async (base) => {
    const denied = await fetch(`${base}/api/v1/applications/case-a/workflow`);
    assert.equal(denied.status, 404);
  }, {
    resolvePrincipal: async () => identity("manager-2", "program_manager", "program", "program-b"),
    applicationRepository: syntheticRepository,
    applicationWorkflowRepository: syntheticWorkflowRepository,
  });
});


const syntheticWorkspaceSummary = {
  casesTotal: 4,
  casesActive: 3,
  casesOverdue: 1,
  tasksActive: 6,
  tasksOverdue: 2,
};

test("workspace summary requires a trusted authenticated staff principal", async () => {
  let summaryLookups = 0;
  await withServer(noDb, async (base) => {
    const response = await fetch(`${base}/api/v1/workspace/summary`, {
      headers: { "x-user-id": "worker-1", "x-role": "case_worker" },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
    assert.equal(summaryLookups, 0);
  }, {
    workspaceRepository: { async getSummary() { summaryLookups += 1; return syntheticWorkspaceSummary; } },
  });
});

test("workspace summary is limited to case workers and scoped program managers", async () => {
  const allowedPrincipals = [
    identity("worker-1", "case_worker"),
    identity("manager-1", "program_manager", "program", "program-a"),
  ];
  for (const principal of allowedPrincipals) {
    await withServer(noDb, async (base) => {
      const response = await fetch(`${base}/api/v1/workspace/summary`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { summary: syntheticWorkspaceSummary });
    }, {
      resolvePrincipal: async () => principal,
      workspaceRepository: { async getSummary() { return syntheticWorkspaceSummary; } },
    });
  }

  for (const principal of [
    identity("applicant-1", "applicant"),
    identity("auditor-1", "auditor"),
    identity("admin-1", "administrator"),
    identity("unscoped-manager", "program_manager"),
  ]) {
    let summaryLookups = 0;
    await withServer(noDb, async (base) => {
      const response = await fetch(`${base}/api/v1/workspace/summary`);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "workspace_access_denied" });
      assert.equal(summaryLookups, 0);
    }, {
      resolvePrincipal: async () => principal,
      workspaceRepository: { async getSummary() { summaryLookups += 1; return syntheticWorkspaceSummary; } },
    });
  }
});

test("workspace summary hides repository failures and does not expose internal details", async () => {
  await withServer(noDb, async (base) => {
    const response = await fetch(`${base}/api/v1/workspace/summary`);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { error: "workspace_unavailable" });
    assert.equal(body.includes("private"), false);
  }, {
    resolvePrincipal: async () => identity("worker-1", "case_worker"),
    workspaceRepository: { async getSummary() { throw new Error("private database details"); } },
  });
});


test("workspace summary SQL binds the authenticated principal and exact program scopes", async () => {
  const cases = [
    {
      principal: identity("worker-uuid", "case_worker"),
      expected: ["worker-uuid", true, []],
    },
    {
      principal: {
        id: "manager-uuid",
        accountStatus: "active",
        grants: [
          grant("program_manager", "program", "program-a"),
          grant("program_manager", "program", "program-b"),
        ],
      },
      expected: ["manager-uuid", false, ["program-a", "program-b"]],
    },
  ];

  for (const item of cases) {
    let captured;
    await withServer({
      async query(sql, params) {
        captured = { sql, params };
        return { rows: [{
          cases_total: 2, cases_active: 1, cases_overdue: 0,
          tasks_active: 3, tasks_overdue: 1,
        }] };
      },
    }, async (base) => {
      const response = await fetch(`${base}/api/v1/workspace/summary`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        summary: {
          casesTotal: 2, casesActive: 1, casesOverdue: 0,
          tasksActive: 3, tasksOverdue: 1,
        },
      });
    }, { resolvePrincipal: async () => item.principal });

    assert.deepEqual(captured.params, item.expected);
    assert.match(captured.sql, /assigned_to = \$1::uuid/);
    assert.match(captured.sql, /program_id::text = ANY\(\$3::text\[\]\)/);
    assert.doesNotMatch(captured.sql, /applicant_id|subject|description|email/i);
  }
});


test("workspace task queue requires authentication and an authorized staff role", async () => {
  let taskLookups = 0;
  await withServer(noDb, async (base) => {
    const anonymous = await fetch(`${base}/api/v1/workspace/tasks`);
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), { error: "authentication_required" });
  }, {
    workspaceRepository: { async getTasks() { taskLookups += 1; return []; } },
  });
  for (const principal of [
    identity("applicant-1", "applicant"),
    identity("auditor-1", "auditor"),
    identity("admin-1", "administrator"),
  ]) {
    await withServer(noDb, async (base) => {
      const response = await fetch(`${base}/api/v1/workspace/tasks`);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "workspace_access_denied" });
    }, {
      resolvePrincipal: async () => principal,
      workspaceRepository: { async getTasks() { taskLookups += 1; return []; } },
    });
  }
  assert.equal(taskLookups, 0);
});

test("workspace task queue validates filters and bounds page size before querying", async () => {
  let taskLookups = 0;
  await withServer(noDb, async (base) => {
    for (const query of [
      "?status=unknown",
      "?overdue=yes",
      "?limit=0",
      "?limit=51",
      "?limit=1.5",
    ]) {
      const response = await fetch(`${base}/api/v1/workspace/tasks${query}`);
      assert.equal(response.status, 400);
    }
  }, {
    resolvePrincipal: async () => identity("worker-1", "case_worker"),
    workspaceRepository: { async getTasks() { taskLookups += 1; return []; } },
  });
  assert.equal(taskLookups, 0);
});

test("case worker task queue is restricted to tasks assigned to that principal", async () => {
  let captured;
  const past = new Date(Date.now() - 60_000).toISOString();
  await withServer({
    async query(sql, params) {
      captured = { sql, params };
      return { rows: [{
        id: "task-a", application_id: "case-a", program_id: "program-a",
        title: "Prepare supporting documents", status: "open", priority: "high",
        due_at: past, escalation_level: 1, escalated_at: past,
        completed_at: null, created_at: past,
      }] };
    },
  }, async (base) => {
    const response = await fetch(`${base}/api/v1/workspace/tasks?status=open&overdue=true&limit=10`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.count, 1);
    assert.equal(body.tasks[0].id, "task-a");
    assert.equal(body.tasks[0].overdue, true);
    assert.equal(body.tasks[0].applicationId, "case-a");
    assert.equal("applicantId" in body.tasks[0], false);
    assert.equal("email" in body.tasks[0], false);
  }, {
    resolvePrincipal: async () => identity("worker-uuid", "case_worker"),
  });

  assert.deepEqual(captured.params, ["worker-uuid", true, [], "open", true, 10]);
  assert.match(captured.sql, /t\.assigned_to = \$1::uuid/);
  assert.match(captured.sql, /a\.program_id::text = ANY\(\$3::text\[\]\)/);
  assert.match(captured.sql, /LIMIT \$6/);
  assert.doesNotMatch(captured.sql, /applicant_id|email|phone|subject/i);
});

test("program manager task queue is limited to explicitly granted program scopes", async () => {
  let captured;
  await withServer({
    async query(sql, params) {
      captured = { sql, params };
      return { rows: [] };
    },
  }, async (base) => {
    const response = await fetch(`${base}/api/v1/workspace/tasks?overdue=false&limit=50`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { tasks: [], count: 0 });
  }, {
    resolvePrincipal: async () => ({
      id: "manager-uuid",
      accountStatus: "active",
      grants: [
        grant("program_manager", "program", "program-a"),
        grant("program_manager", "program", "program-b"),
      ],
    }),
  });

  assert.deepEqual(captured.params, ["manager-uuid", false, ["program-a", "program-b"], null, false, 50]);
  assert.match(captured.sql, /a\.program_id::text = ANY\(\$3::text\[\]\)/);
});


test("approval inbox requires an independent approver grant", async () => {
  let lookups = 0;
  await withServer(noDb, async (base) => {
    const anonymous = await fetch(`${base}/api/v1/approvals/inbox`);
    assert.equal(anonymous.status, 401);
  });
  for (const principal of [
    identity("worker-1", "case_worker"),
    identity("manager-1", "program_manager", "program", "program-a"),
    identity("auditor-1", "auditor"),
  ]) {
    await withServer(noDb, async (base) => {
      const response = await fetch(`${base}/api/v1/approvals/inbox`);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "approval_inbox_access_denied" });
    }, {
      resolvePrincipal: async () => principal,
      approvalRepository: { async getInbox() { lookups += 1; return []; } },
    });
  }
  assert.equal(lookups, 0);
});

test("approval inbox returns only assigned items in granted program scope", async () => {
  let captured;
  await withServer(noDb, async (base) => {
    const response = await fetch(`${base}/api/v1/approvals/inbox?limit=10`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.count, 1);
    assert.deepEqual(body.approvals[0], {
      id: "approval-a",
      objectType: "asset_valuation",
      objectId: "valuation-a",
      programId: "program-a",
      title: "Review asset valuation",
      summary: "Synthetic approval summary",
      submittedBy: "author-uuid",
      reviewerId: "reviewer-uuid",
      status: "pending",
      materialsVersion: "v3",
      submittedAt: "2026-11-05T10:00:00.000Z",
    });
    assert.equal("email" in body.approvals[0], false);
    assert.equal("applicantId" in body.approvals[0], false);
  }, {
    resolvePrincipal: async () => ({
      id: "reviewer-uuid",
      accountStatus: "active",
      grants: [grant("independent_approver", "program", "program-a")],
    }),
    approvalRepository: {
      async getInbox(principal, limit) {
        captured = { principal, limit };
        return [{
          id: "approval-a", objectType: "asset_valuation", objectId: "valuation-a",
          programId: "program-a", title: "Review asset valuation",
          summary: "Synthetic approval summary", submittedBy: "author-uuid",
          reviewerId: "reviewer-uuid", status: "pending", materialsVersion: "v3",
          submittedAt: "2026-11-05T10:00:00.000Z",
        }];
      },
    },
  });
  assert.equal(captured.principal.id, "reviewer-uuid");
  assert.equal(captured.limit, 10);
});

test("approval inbox rejects invalid limits and never offers decision writes", async () => {
  let lookups = 0;
  await withServer(noDb, async (base) => {
    for (const query of ["?limit=0", "?limit=51", "?limit=2.5"]) {
      const response = await fetch(`${base}/api/v1/approvals/inbox${query}`);
      assert.equal(response.status, 400);
    }
    const write = await fetch(`${base}/api/v1/approvals/inbox`, {
      method: "POST", headers: { origin: "https://platform.example", "content-type": "application/json" },
      body: JSON.stringify({ decision: "approved" }),
    });
    assert.equal(write.status, 405);
  }, {
    resolvePrincipal: async () => identity("reviewer-uuid", "independent_approver"),
    approvalRepository: { async getInbox() { lookups += 1; return []; } },
    allowedOrigin: "https://platform.example",
  });
  assert.equal(lookups, 0);
});


test("approval inbox SQL enforces assigned reviewer, maker-checker separation, and program scope", async () => {
  let captured;
  await withServer({
    async query(sql, params) {
      captured = { sql, params };
      return { rows: [] };
    },
  }, async (base) => {
    const response = await fetch(`${base}/api/v1/approvals/inbox?limit=17`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { approvals: [], count: 0 });
  }, {
    resolvePrincipal: async () => ({
      id: "reviewer-uuid",
      accountStatus: "active",
      grants: [
        grant("independent_approver", "program", "program-a"),
        grant("independent_approver", "program", "program-b"),
      ],
    }),
  });

  assert.deepEqual(captured.params, ["reviewer-uuid", false, ["program-a", "program-b"], 17]);
  assert.match(captured.sql, /reviewer_id = \$1::uuid/);
  assert.match(captured.sql, /submitted_by <> \$1::uuid/);
  assert.match(captured.sql, /program_id::text = ANY\(\$3::text\[\]\)/);
  assert.match(captured.sql, /status IN \('pending', 'in_review'\)/);
  assert.match(captured.sql, /LIMIT \$4/);
  assert.doesNotMatch(captured.sql, /applicant_id|email|password_hash|storage_key/i);
});






test("approval detail is visible only to the assigned independent reviewer and returns an audit timeline", async () => {
  let captured;
  await withServer({
    async query(sql, params) {
      if (sql.includes("FROM approval_requests")) {
        captured = { sql, params };
        return { rows: [{
          id: "00000000-0000-4000-8000-000000000001", object_type: "asset_valuation", object_id: "valuation-a",
          program_id: "program-a", title: "Review asset valuation",
          summary: "Synthetic summary", submitted_by: "author-uuid",
          reviewer_id: "reviewer-uuid", status: "pending", materials_version: "v3",
          submitted_at: "2026-11-05T10:00:00.000Z", decided_at: null,
        }] };
      }
      return { rows: [{
        id: 1, actor_id: "author-uuid", event_type: "submitted",
        rationale: "Submitted for independent review", materials_version: "v3",
        created_at: "2026-11-05T10:00:00.000Z",
      }] };
    },
  }, async (base) => {
    const response = await fetch(base + "/api/v1/approvals/00000000-0000-4000-8000-000000000001");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.approval.id, "00000000-0000-4000-8000-000000000001");
    assert.equal(body.approval.events.length, 1);
    assert.equal(body.approval.events[0].type, "submitted");
    assert.equal("applicantId" in body.approval, false);
    assert.equal("email" in body.approval, false);
  }, {
    resolvePrincipal: async () => identity("reviewer-uuid", "independent_approver", "program", "program-a"),
  });
  assert.deepEqual(captured.params, ["00000000-0000-4000-8000-000000000001", "reviewer-uuid", false, ["program-a"]]);
  assert.ok(captured.sql.includes("reviewer_id = $2::uuid"));
  assert.ok(captured.sql.includes("submitted_by <> $2::uuid"));
  assert.ok(captured.sql.includes("program_id::text = ANY($4::text[])"));
});

test("approval detail hides unassigned, out-of-scope and self-authored records", async () => {
  let lookups = 0;
  for (const principal of [
    identity("reviewer-uuid", "independent_approver", "program", "program-b"),
    identity("author-uuid", "independent_approver", "global"),
    identity("worker-uuid", "case_worker"),
  ]) {
    await withServer(noDb, async (base) => {
      const response = await fetch(base + "/api/v1/approvals/00000000-0000-4000-8000-000000000001");
      assert.equal(response.status, principal.grants[0].roleCode === "case_worker" ? 403 : 404);
    }, {
      resolvePrincipal: async () => principal,
      approvalRepository: {
        async getById() {
          lookups += 1;
          if (principal.id === "reviewer-uuid") return {
            id: "00000000-0000-4000-8000-000000000001", reviewerId: "reviewer-uuid", submittedBy: "author-uuid", programId: "program-a",
          };
          if (principal.id === "author-uuid") return {
            id: "00000000-0000-4000-8000-000000000001", reviewerId: "author-uuid", submittedBy: "author-uuid", programId: "program-a",
          };
          return null;
        },
      },
    });
  }
  assert.equal(lookups, 2);
});

test("approval detail fails closed without authentication and never accepts write methods", async () => {
  let lookups = 0;
  await withServer(noDb, async (base) => {
    const anonymous = await fetch(base + "/api/v1/approvals/00000000-0000-4000-8000-000000000001");
    assert.equal(anonymous.status, 401);
    const write = await fetch(base + "/api/v1/approvals/00000000-0000-4000-8000-000000000001", { method: "POST", headers: { origin: "https://platform.example" } });
    assert.equal(write.status, 405);
  }, {
    approvalRepository: { async getById() { lookups += 1; return null; } },
    allowedOrigin: "https://platform.example",
  });
  assert.equal(lookups, 0);
});

test("program directory requires trusted authentication", async () => {
  let lookups = 0;
  await withServer(noDb, async (base) => {
    const anonymous = await fetch(base + "/api/v1/programs");
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), { error: "authentication_required" });
    assert.equal(lookups, 0);
  }, {
    programRepository: {
      async listVisible() { lookups += 1; return []; },
    },
    allowedOrigin: "https://platform.example",
  });
});

test("program directory bounds the result limit and rejects write methods", async () => {
  let lookups = 0;
  await withServer(noDb, async (base) => {
    for (const value of ["0", "51", "2.5", "invalid"]) {
      const invalid = await fetch(base + "/api/v1/programs?limit=" + value);
      assert.equal(invalid.status, 400);
      assert.deepEqual(await invalid.json(), { error: "invalid_limit" });
    }
    const write = await fetch(base + "/api/v1/programs", { method: "POST", headers: { origin: "https://platform.example" } });
    assert.equal(write.status, 405);
    assert.equal(lookups, 0);
  }, {
    resolvePrincipal: async () => identity("staff-1", "case_worker"),
    programRepository: {
      async listVisible() { lookups += 1; return []; },
    },
  });
});

test("program directory exposes only open programs to applicants", async () => {
  let received;
  await withServer(noDb, async (base) => {
    const response = await fetch(base + "/api/v1/programs?limit=10");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      programs: [{
        id: "program-a", name: "Открытый мир", status: "open",
      }],
      count: 1,
    });
  }, {
    resolvePrincipal: async () => identity("applicant-1", "applicant"),
    programRepository: {
      async listVisible(principal, limit) {
        received = { principal, limit };
        return [
          { id: "program-a", name: "Открытый мир", status: "open" },
          { id: "program-b", name: "Помоги сам себе", status: "draft" },
        ];
      },
    },
  });
  assert.equal(received.principal.id, "applicant-1");
  assert.equal(received.limit, 10);
});

test("program directory SQL limits applicants to open records and binds scope filters", async () => {
  let captured;
  await withServer({
    async query(sql, params) {
      captured = { sql, params };
      return { rows: [
        { id: "program-a", name: "Открытый мир", status: "open" },
        { id: "program-b", name: "Помоги сам себе", status: "draft" },
      ] };
    },
  }, async (base) => {
    const response = await fetch(base + "/api/v1/programs?limit=12");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.programs.map((program) => program.id), ["program-a"]);
    assert.equal(body.count, 1);
  }, {
    resolvePrincipal: async () => identity("applicant-1", "applicant"),
  });
  assert.deepEqual(captured.params, [false, [], true, 12]);
  assert.match(captured.sql, /status = 'open'/);
  assert.match(captured.sql, /id::text = ANY\(\$2::text\[\]\)/);
  assert.match(captured.sql, /LIMIT \$4/);
  assert.doesNotMatch(captured.sql, /applicant_id|email|password_hash|storage_key/i);
});

test("program directory returns only exact program scopes to a program manager", async () => {
  let captured;
  await withServer({
    async query(sql, params) {
      captured = { sql, params };
      return { rows: [
        { id: "program-a", name: "Открытый мир", status: "draft" },
        { id: "program-b", name: "Помоги сам себе", status: "open" },
      ] };
    },
  }, async (base) => {
    const response = await fetch(base + "/api/v1/programs");
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.programs.map((program) => program.id), ["program-a"]);
  }, {
    resolvePrincipal: async () => identity("manager-1", "program_manager", "program", "program-a"),
  });
  assert.deepEqual(captured.params, [false, ["program-a"], false, 25]);
});
