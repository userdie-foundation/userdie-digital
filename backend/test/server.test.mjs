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

test("CORS allows only the configured exact origin", async () => {
  await withServer(noDb, async (base) => {
    const allowed = await fetch(`${base}/api/v1/health/live`, { headers: { origin: "https://platform.example" } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), "https://platform.example");
    const rejected = await fetch(`${base}/api/v1/health/live`, { headers: { origin: "https://attacker.example" } });
    assert.equal(rejected.headers.get("access-control-allow-origin"), null);
  }, { allowedOrigin: "https://platform.example" });
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
        method, headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: "synthetic" }),
      });
      assert.equal(response.status, 405);
      assert.deepEqual(await response.json(), { error: "method_not_allowed" });
    }
    assert.equal(queries, 0);
  });
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
