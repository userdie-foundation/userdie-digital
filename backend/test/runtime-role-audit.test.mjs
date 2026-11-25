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
        can_any_column_insert: false,
        can_any_column_update: false,
        can_any_column_references: false,
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
        can_any_column_insert: false,
        can_any_column_update: false,
        can_any_column_references: false,
      },
    ],
    triggers: [
      ["privacy_consent_documents", "privacy_consent_documents_immutable", "protect_privacy_consent_document_versions"],
      ["privacy_consent_documents", "privacy_consent_documents_no_truncate", "prevent_privacy_consent_document_truncate"],
      ["privacy_consent_documents", "privacy_consent_documents_validate_choices", "validate_privacy_consent_document_choices"],
      ["privacy_consent_events", "privacy_consent_events_integrity", "enforce_privacy_consent_event_integrity"],
      ["privacy_consent_events", "privacy_consent_events_no_update_delete", "prevent_privacy_consent_event_mutation"],
      ["privacy_consent_events", "privacy_consent_events_no_truncate", "prevent_privacy_consent_event_mutation"],
    ].map(([table_name, trigger_name, function_name]) => ({
      table_name,
      trigger_name,
      enabled: "O",
      function_name,
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


test("rejects column-only INSERT, UPDATE, and REFERENCES grants on protected consent tables", () => {
  const fixture = acceptedFixture();
  fixture.tables[0].can_any_column_insert = true;
  fixture.tables[1].can_any_column_update = true;
  fixture.tables[1].can_any_column_references = true;
  const findings = evaluateRuntimeRoleAudit(fixture);
  assert.ok(findings.some((finding) => finding.includes("privacy_consent_documents: unexpected effective column-level INSERT")));
  assert.ok(findings.some((finding) => finding.includes("privacy_consent_events: unexpected effective column-level UPDATE")));
  assert.ok(findings.some((finding) => finding.includes("privacy_consent_events: unexpected effective column-level REFERENCES")));
});

test("rejects missing or disabled protection triggers and runtime-owned trigger functions", () => {
  const fixture = acceptedFixture();
  fixture.triggers[0].enabled = "D";
  fixture.triggers[1].function_owner = fixture.role.rolname;
  const findings = evaluateRuntimeRoleAudit(fixture);
  assert.ok(findings.some((finding) => finding.includes("privacy_consent_documents_immutable")));
  assert.ok(findings.some((finding) => finding.includes("owns protection function")));
});

test("rejects a protection trigger name wired to an unexpected function", () => {
  const fixture = acceptedFixture();
  fixture.triggers[0].function_name = "untrusted_noop_trigger";
  const findings = evaluateRuntimeRoleAudit(fixture);
  assert.ok(findings.some((finding) => finding.includes("does not call expected function")));
});

test("rejects a correctly named trigger attached to the wrong consent table", () => {
  const fixture = acceptedFixture();
  fixture.triggers[0].table_name = "privacy_consent_events";
  const findings = evaluateRuntimeRoleAudit(fixture);
  assert.ok(findings.some((finding) => finding.includes("attached to the wrong table")));
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
