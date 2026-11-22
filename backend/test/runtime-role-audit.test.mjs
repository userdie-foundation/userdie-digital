import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRuntimeRoleAudit } from "../scripts/audit-runtime-role.mjs";

function acceptedFixture() {
  return {
    role: {
      oid: 42,
      rolname: "userdie_api_runtime",
      rolcanlogin: true,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolbypassrls: false,
    },
    memberships: [],
    schema: { can_use: true, can_create: false, owner: "userdie_schema_owner" },
    tables: [
      {
        table_name: "privacy_consent_documents",
        owner: "userdie_schema_owner",
        can_select: true,
        can_insert: false,
        can_update: false,
        can_delete: false,
        can_truncate: false,
        can_references: false,
        can_trigger: false,
      },
      {
        table_name: "privacy_consent_events",
        owner: "userdie_schema_owner",
        can_select: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
        can_truncate: false,
        can_references: false,
        can_trigger: false,
      },
    ],
    triggers: [
      "privacy_consent_documents_immutable",
      "privacy_consent_documents_no_truncate",
      "privacy_consent_documents_validate_choices",
      "privacy_consent_events_integrity",
      "privacy_consent_events_no_update_delete",
      "privacy_consent_events_no_truncate",
    ].map((trigger_name) => ({
      trigger_name,
      enabled: "O",
      function_owner: "userdie_schema_owner",
    })),
    defaultGrants: [],
  };
}

test("accepts the intended least-privilege consent-ledger runtime role", () => {
  assert.deepEqual(evaluateRuntimeRoleAudit(acceptedFixture()), []);
});

test("rejects elevated role attributes and inherited role memberships", () => {
  const fixture = acceptedFixture();
  fixture.role.rolbypassrls = true;
  fixture.role.rolcreaterole = true;
  fixture.memberships = [{ rolname: "userdie_schema_owner" }];
  const findings = evaluateRuntimeRoleAudit(fixture);
  assert.ok(findings.some((finding) => finding.includes("rolbypassrls")));
  assert.ok(findings.some((finding) => finding.includes("rolcreaterole")));
  assert.ok(findings.some((finding) => finding.includes("memberships")));
});

test("rejects write privileges on the immutable consent-document registry", () => {
  const fixture = acceptedFixture();
  fixture.tables[0].can_update = true;
  fixture.tables[0].can_delete = true;
  const findings = evaluateRuntimeRoleAudit(fixture);
  assert.ok(findings.some((finding) => finding.includes("privacy_consent_documents: unexpected effective UPDATE")));
  assert.ok(findings.some((finding) => finding.includes("privacy_consent_documents: unexpected effective DELETE")));
});

test("rejects missing or disabled protection triggers and runtime-owned trigger functions", () => {
  const fixture = acceptedFixture();
  fixture.triggers[0].enabled = "D";
  fixture.triggers[1].function_owner = fixture.role.rolname;
  const findings = evaluateRuntimeRoleAudit(fixture);
  assert.ok(findings.some((finding) => finding.includes("privacy_consent_documents_immutable")));
  assert.ok(findings.some((finding) => finding.includes("owns protection function")));
});

test("rejects runtime ownership, schema creation, and default grants", () => {
  const fixture = acceptedFixture();
  fixture.schema.owner = fixture.role.rolname;
  fixture.schema.can_create = true;
  fixture.tables[1].owner = fixture.role.rolname;
  fixture.defaultGrants = [{ object_type: "r", schema_name: "public" }];
  const findings = evaluateRuntimeRoleAudit(fixture);
  assert.ok(findings.some((finding) => finding.includes("owns the application schema")));
  assert.ok(findings.some((finding) => finding.includes("can CREATE")));
  assert.ok(findings.some((finding) => finding.includes("owns protected table")));
  assert.ok(findings.some((finding) => finding.includes("default privilege")));
});

test("rejects default privileges granted to PUBLIC as well as directly to the runtime role", () => {
  const fixture = acceptedFixture();
  fixture.defaultGrants = [
    { object_type: "r", schema_name: "public", grantee: "PUBLIC" },
  ];
  const findings = evaluateRuntimeRoleAudit(fixture);
  assert.ok(findings.some((finding) => finding.includes("via PUBLIC")));
});

test("fails closed when the configured runtime role is absent", () => {
  const fixture = acceptedFixture();
  fixture.role = null;
  assert.deepEqual(evaluateRuntimeRoleAudit(fixture), ["Configured runtime role does not exist."]);
});
