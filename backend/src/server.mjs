import { isAuthorized, isValidPrincipal } from "./security/authorization.mjs";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

function sendJson(res, status, body, method = "GET") {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(method === "HEAD" ? undefined : JSON.stringify(body));
}

function createProgramRepository(pool) {
  return {
    async getById(id) {
      const result = await pool.query(
        "SELECT id, code, name, description, status, organizational_contour, objective, target_groups, geography, starts_at, ends_at FROM programs WHERE id = $1 LIMIT 1",
        [id],
      );
      const row = result.rows?.[0];
      if (!row) return null;
      const milestonesResult = await pool.query(
        "SELECT id, code, title, description, status, due_at, completed_at FROM program_milestones WHERE program_id = $1 ORDER BY due_at NULLS LAST, created_at ASC",
        [id],
      );
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        status: row.status,
        organizationalContour: row.organizational_contour,
        objective: row.objective,
        targetGroups: row.target_groups,
        geography: row.geography,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        milestones: (milestonesResult.rows ?? []).map((milestone) => ({
          id: milestone.id,
          code: milestone.code,
          title: milestone.title,
          description: milestone.description,
          status: milestone.status,
          dueAt: milestone.due_at,
          completedAt: milestone.completed_at,
        })),
      };
    },
  };
}

function createApplicationRepository(pool) {
  return {
    async getById(id) {
      const result = await pool.query(
        "SELECT id, applicant_id, assigned_to, program_id, status, subject FROM applications WHERE id = $1 LIMIT 1",
        [id],
      );
      const row = result.rows?.[0];
      if (!row) return null;
      return {
        id: row.id,
        applicantId: row.applicant_id,
        assignedTo: row.assigned_to,
        programId: row.program_id,
        status: row.status,
        subject: row.subject,
        // Partner sharing is intentionally unavailable until its persistence
        // model and governance rules are reviewed and migrated.
        sharedWithPrincipalIds: [],
      };
    },
  };
}

function createApplicationWorkflowRepository(pool) {
  return {
    async getByApplicationId(applicationId) {
      const tasksResult = await pool.query(
        "SELECT id, title, status, priority, assigned_to, due_at, escalation_level, escalated_at, completed_at FROM application_tasks WHERE application_id = $1 ORDER BY due_at NULLS LAST, created_at ASC",
        [applicationId],
      );
      const eventsResult = await pool.query(
        "SELECT id, task_id, event_type, actor_id, summary, metadata, created_at FROM application_workflow_events WHERE application_id = $1 ORDER BY created_at DESC LIMIT 100",
        [applicationId],
      );
      return {
        tasks: (tasksResult.rows ?? []).map((row) => ({
          id: row.id, title: row.title, status: row.status, priority: row.priority,
          assignedTo: row.assigned_to, dueAt: row.due_at,
          escalationLevel: row.escalation_level, escalatedAt: row.escalated_at,
          completedAt: row.completed_at,
        })),
        events: (eventsResult.rows ?? []).map((row) => ({
          id: row.id, taskId: row.task_id, type: row.event_type,
          actorId: row.actor_id, summary: row.summary,
          status: row.metadata?.status ?? null,
          priority: row.metadata?.priority ?? null,
          escalationLevel: row.metadata?.escalation_level ?? null,
          createdAt: row.created_at,
        })),
      };
    },
  };
}

/**
 * resolvePrincipal must verify a server-side session and load account status
 * and grants from trusted storage. Never trust role/user/scope claims supplied
 * by request headers, query parameters, or request bodies.
 *
 * The production entry point injects the database-backed session resolver.
 * Protected routes remain unavailable (401) until a valid session has been
 * issued through a separately reviewed authentication process.
 */

function createApprovalRepository(pool) {
  return {
    async getInbox(principal, limit) {
      const hasGlobalReviewerGrant = principal.grants.some((grant) =>
        grant?.roleCode === "independent_approver" && grant.scopeType === "global"
      );
      const programIds = [...new Set(principal.grants
        .filter((grant) => grant?.roleCode === "independent_approver" &&
          grant.scopeType === "program" && typeof grant.scopeId === "string")
        .map((grant) => grant.scopeId))];

      const result = await pool.query(
        `SELECT
           id, object_type, object_id, program_id, title, summary,
           submitted_by, reviewer_id, status, materials_version, submitted_at
         FROM approval_requests
         WHERE reviewer_id = $1::uuid
           AND submitted_by <> $1::uuid
           AND status IN ('pending', 'in_review')
           AND ($2::boolean OR program_id::text = ANY($3::text[]))
         ORDER BY submitted_at ASC, id ASC
         LIMIT $4`,
        [principal.id, hasGlobalReviewerGrant, programIds, limit],
      );
      return (result.rows ?? []).map((row) => ({
        id: row.id,
        objectType: row.object_type,
        objectId: row.object_id,
        programId: row.program_id,
        title: row.title,
        summary: row.summary,
        submittedBy: row.submitted_by,
        reviewerId: row.reviewer_id,
        status: row.status,
        materialsVersion: row.materials_version,
        submittedAt: row.submitted_at,
      }));
    },
  };
}

function createWorkspaceRepository(pool) {
  return {
    async getTasks(principal, filters) {
      const canReadAssignedTasks = principal.grants.some((grant) =>
        grant?.roleCode === "case_worker" && grant.scopeType === "global"
      );
      const programIds = [...new Set(principal.grants
        .filter((grant) => grant?.roleCode === "program_manager" &&
          grant.scopeType === "program" && typeof grant.scopeId === "string")
        .map((grant) => grant.scopeId))];

      const result = await pool.query(
        `SELECT
           t.id, t.application_id, t.program_id, t.title, t.status,
           t.priority, t.due_at, t.escalation_level, t.escalated_at,
           t.completed_at, t.created_at
         FROM application_tasks t
         JOIN applications a ON a.id = t.application_id
         WHERE (($2::boolean AND t.assigned_to = $1::uuid)
           OR a.program_id::text = ANY($3::text[]))
           AND ($4::text IS NULL OR t.status = $4)
           AND (
             $5::boolean IS NULL
             OR ($5::boolean = true
               AND t.due_at < now()
               AND t.status IN ('open', 'in_progress', 'blocked'))
             OR ($5::boolean = false
               AND (t.due_at IS NULL OR t.due_at >= now()
                 OR t.status NOT IN ('open', 'in_progress', 'blocked')))
           )
         ORDER BY
           CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1
             WHEN 'normal' THEN 2 ELSE 3 END,
           t.due_at ASC NULLS LAST,
           t.created_at ASC
         LIMIT $6`,
        [principal.id, canReadAssignedTasks, programIds,
          filters.status, filters.overdue, filters.limit],
      );
      const now = Date.now();
      return (result.rows ?? []).map((row) => ({
        id: row.id,
        applicationId: row.application_id,
        programId: row.program_id,
        title: row.title,
        status: row.status,
        priority: row.priority,
        dueAt: row.due_at,
        overdue: Boolean(row.due_at && new Date(row.due_at).getTime() < now &&
          ["open", "in_progress", "blocked"].includes(row.status)),
        escalationLevel: row.escalation_level,
        escalatedAt: row.escalated_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
      }));
    },
    async getSummary(principal) {
      const canReadAssignedCases = principal.grants.some((grant) =>
        grant?.roleCode === "case_worker" && grant.scopeType === "global"
      );
      const programIds = [...new Set(principal.grants
        .filter((grant) => grant?.roleCode === "program_manager" &&
          grant.scopeType === "program" && typeof grant.scopeId === "string")
        .map((grant) => grant.scopeId))];

      const result = await pool.query(
        `WITH visible_applications AS (
           SELECT id, status, due_at, program_id
           FROM applications
           WHERE ($2::boolean AND assigned_to = $1::uuid)
              OR program_id::text = ANY($3::text[])
         ),
         visible_tasks AS (
           SELECT t.id, t.status, t.due_at
           FROM application_tasks t
           JOIN visible_applications a ON a.id = t.application_id
         )
         SELECT
           (SELECT count(*)::integer FROM visible_applications) AS cases_total,
           (SELECT count(*)::integer FROM visible_applications
             WHERE status NOT IN ('approved', 'rejected', 'withdrawn', 'completed')) AS cases_active,
           (SELECT count(*)::integer FROM visible_applications
             WHERE due_at < now()
               AND status NOT IN ('approved', 'rejected', 'withdrawn', 'completed')) AS cases_overdue,
           (SELECT count(*)::integer FROM visible_tasks
             WHERE status IN ('open', 'in_progress', 'blocked')) AS tasks_active,
           (SELECT count(*)::integer FROM visible_tasks
             WHERE due_at < now()
               AND status IN ('open', 'in_progress', 'blocked')) AS tasks_overdue`,
        [principal.id, canReadAssignedCases, programIds],
      );
      const row = result.rows?.[0] ?? {};
      const count = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0
        ? Number(value) : 0;
      return {
        casesTotal: count(row.cases_total),
        casesActive: count(row.cases_active),
        casesOverdue: count(row.cases_overdue),
        tasksActive: count(row.tasks_active),
        tasksOverdue: count(row.tasks_overdue),
      };
    },
  };
}

export function createServer({ pool, allowedOrigin, resolvePrincipal, applicationRepository, programRepository, applicationWorkflowRepository, workspaceRepository, approvalRepository } = {}) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A database pool with query() is required");
  }
  const applications = applicationRepository ?? createApplicationRepository(pool);
  const applicationWorkflows = applicationWorkflowRepository ?? createApplicationWorkflowRepository(pool);
  const programs = programRepository ?? createProgramRepository(pool);
  const workspace = workspaceRepository ?? createWorkspaceRepository(pool);
  const approvals = approvalRepository ?? createApprovalRepository(pool);

  return async function handleRequest(req, res) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }

    if (allowedOrigin && req.headers.origin === allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      res.setHeader("Vary", "Origin");
    }

    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, { error: "method_not_allowed" }, req.method);
    }

    if (url.pathname === "/api/v1/health/live") {
      return sendJson(res, 200, { status: "ok" }, req.method);
    }

    if (url.pathname === "/api/v1/health/ready") {
      try {
        await pool.query("SELECT 1");
        return sendJson(res, 200, { status: "ready" }, req.method);
      } catch {
        return sendJson(res, 503, { status: "unavailable" }, req.method);
      }
    }

    const programMatch = url.pathname.match(/^\/api\/v1\/programs\/([^/]+)$/);
    if (programMatch) {
      if (typeof resolvePrincipal !== "function") {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }

      let principal;
      try {
        principal = await resolvePrincipal(req);
      } catch {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      if (!isValidPrincipal(principal)) {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }

      let programId;
      try {
        programId = decodeURIComponent(programMatch[1]);
      } catch {
        return sendJson(res, 400, { error: "invalid_program_id" }, req.method);
      }

      let program;
      try {
        program = await programs.getById(programId);
      } catch {
        return sendJson(res, 503, { error: "programs_unavailable" }, req.method);
      }

      if (!program || !isAuthorized({
        principal,
        permission: "programs:read",
        resource: { programId: program.id, status: program.status },
      })) {
        return sendJson(res, 404, { error: "not_found" }, req.method);
      }

      return sendJson(res, 200, {
        program: {
          id: program.id,
          code: program.code,
          name: program.name,
          description: program.description,
          status: program.status,
          organizationalContour: program.organizationalContour,
          objective: program.objective,
          targetGroups: program.targetGroups,
          geography: program.geography,
          startsAt: program.startsAt,
          endsAt: program.endsAt,
          milestones: program.milestones,
        },
      }, req.method);
    }

    const workflowMatch = url.pathname.match(/^\/api\/v1\/applications\/([^/]+)\/workflow$/);
    if (workflowMatch) {
      if (typeof resolvePrincipal !== "function") {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      let principal;
      try { principal = await resolvePrincipal(req); } catch {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      if (!isValidPrincipal(principal)) {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      let applicationId;
      try { applicationId = decodeURIComponent(workflowMatch[1]); } catch {
        return sendJson(res, 400, { error: "invalid_application_id" }, req.method);
      }
      let application;
      try { application = await applications.getById(applicationId); } catch {
        return sendJson(res, 503, { error: "applications_unavailable" }, req.method);
      }
      if (!application || !isAuthorized({
        principal, permission: "applications:workflow:read", resource: application,
      })) {
        return sendJson(res, 404, { error: "not_found" }, req.method);
      }
      let workflow;
      try { workflow = await applicationWorkflows.getByApplicationId(application.id); } catch {
        return sendJson(res, 503, { error: "application_workflow_unavailable" }, req.method);
      }
      const now = Date.now();
      return sendJson(res, 200, {
        applicationId: application.id,
        tasks: workflow.tasks.map((task) => ({
          id: task.id, title: task.title, status: task.status, priority: task.priority,
          assignedTo: task.assignedTo, dueAt: task.dueAt,
          overdue: Boolean(task.dueAt && new Date(task.dueAt).getTime() < now &&
            !["completed", "cancelled"].includes(task.status)),
          escalationLevel: task.escalationLevel, escalatedAt: task.escalatedAt,
          completedAt: task.completedAt,
        })),
        events: workflow.events.map((event) => ({
          id: event.id, taskId: event.taskId, type: event.type,
          actorId: event.actorId, summary: event.summary, status: event.status,
          priority: event.priority, escalationLevel: event.escalationLevel,
          createdAt: event.createdAt,
        })),
      }, req.method);
    }

    if (url.pathname === "/api/v1/approvals/inbox") {
      if (typeof resolvePrincipal !== "function") {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      let principal;
      try { principal = await resolvePrincipal(req); } catch {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      if (!isValidPrincipal(principal)) {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      if (!isAuthorized({ principal, permission: "approvals:inbox:read" })) {
        return sendJson(res, 403, { error: "approval_inbox_access_denied" }, req.method);
      }
      const limitValue = url.searchParams.get("limit");
      const limit = limitValue === null ? 25 : Number(limitValue);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return sendJson(res, 400, { error: "invalid_limit" }, req.method);
      }
      try {
        const approvalsInbox = await approvals.getInbox(principal, limit);
        return sendJson(res, 200, { approvals: approvalsInbox, count: approvalsInbox.length }, req.method);
      } catch {
        return sendJson(res, 503, { error: "approvals_unavailable" }, req.method);
      }
    }

    if (url.pathname === "/api/v1/workspace/tasks") {
      if (typeof resolvePrincipal !== "function") {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      let principal;
      try { principal = await resolvePrincipal(req); } catch {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      if (!isValidPrincipal(principal)) {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      if (!isAuthorized({ principal, permission: "workspace:tasks:read" })) {
        return sendJson(res, 403, { error: "workspace_access_denied" }, req.method);
      }

      const status = url.searchParams.get("status");
      const allowedStatuses = new Set(["open", "in_progress", "blocked", "completed", "cancelled"]);
      if (status !== null && !allowedStatuses.has(status)) {
        return sendJson(res, 400, { error: "invalid_status_filter" }, req.method);
      }
      const overdueValue = url.searchParams.get("overdue");
      if (overdueValue !== null && overdueValue !== "true" && overdueValue !== "false") {
        return sendJson(res, 400, { error: "invalid_overdue_filter" }, req.method);
      }
      const limitValue = url.searchParams.get("limit");
      const limit = limitValue === null ? 25 : Number(limitValue);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return sendJson(res, 400, { error: "invalid_limit" }, req.method);
      }

      try {
        const tasks = await workspace.getTasks(principal, {
          status,
          overdue: overdueValue === null ? null : overdueValue === "true",
          limit,
        });
        return sendJson(res, 200, { tasks, count: tasks.length }, req.method);
      } catch {
        return sendJson(res, 503, { error: "workspace_unavailable" }, req.method);
      }
    }

    if (url.pathname === "/api/v1/workspace/summary") {
      if (typeof resolvePrincipal !== "function") {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      let principal;
      try { principal = await resolvePrincipal(req); } catch {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      if (!isValidPrincipal(principal)) {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      if (!isAuthorized({ principal, permission: "workspace:summary:read" })) {
        return sendJson(res, 403, { error: "workspace_access_denied" }, req.method);
      }
      try {
        const summary = await workspace.getSummary(principal);
        return sendJson(res, 200, { summary }, req.method);
      } catch {
        return sendJson(res, 503, { error: "workspace_unavailable" }, req.method);
      }
    }

    const applicationMatch = url.pathname.match(/^\/api\/v1\/applications\/([^/]+)$/);
    if (applicationMatch) {
      if (typeof resolvePrincipal !== "function") {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }

      let principal;
      try {
        principal = await resolvePrincipal(req);
      } catch {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }
      if (!isValidPrincipal(principal)) {
        return sendJson(res, 401, { error: "authentication_required" }, req.method);
      }

      let application;
      try {
        application = await applications.getById(decodeURIComponent(applicationMatch[1]));
      } catch {
        return sendJson(res, 503, { error: "applications_unavailable" }, req.method);
      }

      // Identical response for missing and unauthorized records reduces ID probing.
      if (!application || !isAuthorized({
        principal,
        permission: "applications:read",
        resource: application,
      })) {
        return sendJson(res, 404, { error: "not_found" }, req.method);
      }

      return sendJson(res, 200, {
        application: {
          id: application.id,
          programId: application.programId,
          status: application.status,
          subject: application.subject,
        },
      }, req.method);
    }

    if (url.pathname === "/api/v1/applications") {
      return sendJson(res, 503, { error: "applications_module_unavailable" }, req.method);
    }

    return sendJson(res, 404, { error: "not_found" }, req.method);
  };
}
