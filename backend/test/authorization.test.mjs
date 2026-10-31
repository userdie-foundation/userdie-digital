import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorized } from "../src/security/authorization.mjs";

const active = (id, grants) => ({ id, accountStatus: "active", grants });
const grant = (roleCode, scopeType = "global", scopeId) => ({ roleCode, scopeType, ...(scopeId ? { scopeId } : {}) });
const caseA = { applicantId: "person-1", assignedTo: "worker-1", programId: "program-a" };

test("applicant can read only their own application", () => {
  const own = active("person-1", [grant("applicant")]);
  const other = active("person-2", [grant("applicant")]);
  assert.equal(isAuthorized({ principal: own, permission: "applications:read", resource: caseA }), true);
  assert.equal(isAuthorized({ principal: other, permission: "applications:read", resource: caseA }), false);
  assert.equal(isAuthorized({ principal: own, permission: "applications:update", resource: caseA }), false);
});

test("case worker can access only an assigned case", () => {
  const worker = active("worker-1", [grant("case_worker")]);
  const otherWorker = active("worker-2", [grant("case_worker")]);
  assert.equal(isAuthorized({ principal: worker, permission: "applications:read", resource: caseA }), true);
  assert.equal(isAuthorized({ principal: worker, permission: "applications:transition", resource: caseA }), true);
  assert.equal(isAuthorized({ principal: otherWorker, permission: "applications:read", resource: caseA }), false);
});

test("program manager is restricted to the exact program scope", () => {
  const manager = active("manager-1", [grant("program_manager", "program", "program-a")]);
  assert.equal(isAuthorized({ principal: manager, permission: "applications:read", resource: caseA }), true);
  assert.equal(isAuthorized({ principal: manager, permission: "programs:manage", resource: { programId: "program-a" } }), true);
  assert.equal(isAuthorized({ principal: manager, permission: "applications:read", resource: { ...caseA, programId: "program-b" } }), false);
  assert.equal(isAuthorized({ principal: manager, permission: "audit:read", resource: {} }), false);
});

test("partner access requires explicit record sharing", () => {
  const partner = active("partner-1", [grant("partner")]);
  assert.equal(isAuthorized({ principal: partner, permission: "applications:read", resource: { ...caseA, sharedWithPrincipalIds: ["partner-1"] } }), true);
  assert.equal(isAuthorized({ principal: partner, permission: "applications:read", resource: caseA }), false);
  assert.equal(isAuthorized({ principal: partner, permission: "applications:update", resource: caseA }), false);
});

test("auditor can read audit and aggregate analytics, not case content", () => {
  const auditor = active("auditor-1", [grant("auditor")]);
  assert.equal(isAuthorized({ principal: auditor, permission: "audit:read", resource: {} }), true);
  assert.equal(isAuthorized({ principal: auditor, permission: "analytics:read", resource: {} }), true);
  assert.equal(isAuthorized({ principal: auditor, permission: "applications:read", resource: caseA }), false);
  assert.equal(isAuthorized({ principal: auditor, permission: "applications:update", resource: caseA }), false);
});

test("administrator can manage system identities but has no implicit case access", () => {
  const admin = active("admin-1", [grant("administrator")]);
  assert.equal(isAuthorized({ principal: admin, permission: "users:manage", resource: {} }), true);
  assert.equal(isAuthorized({ principal: admin, permission: "system:configure", resource: {} }), true);
  assert.equal(isAuthorized({ principal: admin, permission: "applications:read", resource: caseA }), false);
});

test("inactive, malformed and unscoped principals fail closed", () => {
  const suspended = { ...active("worker-1", [grant("case_worker")]), accountStatus: "suspended" };
  assert.equal(isAuthorized({ principal: suspended, permission: "applications:read", resource: caseA }), false);
  assert.equal(isAuthorized({ principal: { id: "x", accountStatus: "active" }, permission: "users:manage" }), false);
  assert.equal(isAuthorized({ principal: active("x", [grant("program_manager")]), permission: "applications:read", resource: caseA }), false);
  assert.equal(isAuthorized({ principal: active("x", [grant("case_worker")]), permission: "unknown:permission", resource: caseA }), false);
  assert.equal(isAuthorized({ principal: active("x", [grant("case_worker")]), permission: "applications:read" }), false);
});
