/**
 * Fail-closed authorization policy primitives.
 *
 * The policy is enforced by read-only application, workflow, and program
 * routes using the trusted database-backed session principal resolver.
 * All write routes remain disabled pending a separately reviewed workflow.
 * The client must never supply trusted roles or scopes.
 */
const ACTIVE_ACCOUNT_STATES = new Set(["active"]);

export function isValidPrincipal(principal) {
  return Boolean(
    principal &&
    typeof principal.id === "string" &&
    principal.id.length > 0 &&
    ACTIVE_ACCOUNT_STATES.has(principal.accountStatus) &&
    Array.isArray(principal.grants)
  );
}

function hasGrant(principal, roleCode, scopeType, scopeId) {
  return principal.grants.some((grant) =>
    grant &&
    grant.roleCode === roleCode &&
    grant.scopeType === scopeType &&
    (scopeType === "global" || (typeof scopeId === "string" && grant.scopeId === scopeId))
  );
}

function hasProgramGrant(principal, roleCode, programId) {
  return typeof programId === "string" &&
    hasGrant(principal, roleCode, "program", programId);
}

/**
 * @param {{
 *   principal: {id:string, accountStatus:string, grants:Array<{roleCode:string,scopeType:string,scopeId?:string}>},
 *   permission:string,
 *   resource?: {applicantId?:string, assignedTo?:string, programId?:string, sharedWithPrincipalIds?:string[]}
 * }} input
 * @returns {boolean} false for malformed or insufficient context
 */
export function isAuthorized({ principal, permission, resource = {} } = {}) {
  if (!isValidPrincipal(principal) || !resource || typeof resource !== "object") return false;

  switch (permission) {
    case "applications:read":
      return (
        hasGrant(principal, "applicant", "global") &&
          resource.applicantId === principal.id
      ) || (
        hasGrant(principal, "case_worker", "global") &&
          resource.assignedTo === principal.id
      ) || (
        hasProgramGrant(principal, "program_manager", resource.programId)
      ) || (
        hasGrant(principal, "partner", "global") &&
          Array.isArray(resource.sharedWithPrincipalIds) &&
          resource.sharedWithPrincipalIds.includes(principal.id)
      );

    case "applications:workflow:read":
      return (
        hasGrant(principal, "case_worker", "global") &&
        resource.assignedTo === principal.id
      ) || hasProgramGrant(principal, "program_manager", resource.programId);

    case "applications:update":
    case "applications:transition":
      return (
        hasGrant(principal, "case_worker", "global") &&
        resource.assignedTo === principal.id
      ) || hasProgramGrant(principal, "program_manager", resource.programId);

    case "programs:read":
      return (
        hasGrant(principal, "administrator", "global") ||
        hasGrant(principal, "auditor", "global") ||
        hasGrant(principal, "case_worker", "global") ||
        hasProgramGrant(principal, "program_manager", resource.programId) ||
        (
          resource.status === "open" &&
          (
            hasGrant(principal, "applicant", "global") ||
            hasGrant(principal, "partner", "global")
          )
        )
      );

    case "programs:manage":
      return hasProgramGrant(principal, "program_manager", resource.programId);

    case "analytics:read":
      return (
        hasGrant(principal, "administrator", "global") ||
        hasGrant(principal, "auditor", "global") ||
        hasProgramGrant(principal, "program_manager", resource.programId)
      );

    case "approvals:detail:read":
      return (
        resource.reviewerId === principal.id &&
        resource.submittedBy !== principal.id &&
        (
          hasGrant(principal, "independent_approver", "global") ||
          hasProgramGrant(principal, "independent_approver", resource.programId)
        )
      );

    case "approvals:inbox:read":
      return (
        hasGrant(principal, "independent_approver", "global") ||
        principal.grants.some((grant) =>
          grant?.roleCode === "independent_approver" &&
          grant.scopeType === "program" &&
          typeof grant.scopeId === "string"
        )
      );

    case "workspace:tasks:read":
      return (
        hasGrant(principal, "case_worker", "global") ||
        principal.grants.some((grant) =>
          grant?.roleCode === "program_manager" &&
          grant.scopeType === "program" &&
          typeof grant.scopeId === "string"
        )
      );

    case "workspace:summary:read":
      return (
        hasGrant(principal, "case_worker", "global") ||
        principal.grants.some((grant) =>
          grant?.roleCode === "program_manager" &&
          grant.scopeType === "program" &&
          typeof grant.scopeId === "string"
        )
      );

    case "audit:read":
      return hasGrant(principal, "auditor", "global");

    case "users:manage":
    case "system:configure":
      return hasGrant(principal, "administrator", "global");

    default:
      return false;
  }
}
