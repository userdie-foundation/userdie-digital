import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { once } from "node:events";
import {
  handlePrivacyConsentRequest,
  isPrivacyConsentMethodAllowed,
  isPrivacyConsentRoute,
} from "../src/privacy-consents.mjs";

const principal = { id: "subject-1", accountStatus: "active", grants: [{ roleCode: "applicant", scopeType: "global" }] };

async function withHandler(options, run) {
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const handled = await handlePrivacyConsentRequest({
      req, res, url, ...options,
    });
    if (!handled) { res.writeHead(404); res.end(); }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function createPool({ document = true, latestEvent = null } = {}) {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const normalized = sql.trim();
      calls.push({ sql: normalized, params });
      if (normalized === "SELECT id FROM app_users WHERE id = $1 FOR UPDATE") {
        return { rows: [{ id: params[0] }] };
      }
      if (normalized.includes("FROM privacy_consent_documents")) {
        return { rows: document ? [{
          id: "document-1", document_code: "aid_support", document_version: "2026-11-19.1",
          consent_type: "personal_data", purpose_code: "case_review",
          document_sha256: "a".repeat(64), choice_keys: ["contact_by_email", "contact_by_phone"],
        }] : [] };
      }
      if (normalized.includes("FROM privacy_consent_events") && normalized.includes("ORDER BY")) {
        return { rows: latestEvent ? [latestEvent] : [] };
      }
      if (normalized.startsWith("INSERT INTO privacy_consent_events")) {
        return { rows: [{ id: "event-1", event_type: normalized.includes("'withdrawn'") ? "withdrawn" : "granted", occurred_at: "2026-11-19T00:00:00Z" }] };
      }
      if (normalized.startsWith("INSERT INTO audit_events")) return { rows: [] };
      if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") return { rows: [] };
      throw new Error("Unexpected SQL: " + normalized);
    },
    release() { calls.push({ sql: "RELEASE", params: [] }); },
  };
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: sql.trim(), params });
      if (sql.includes("FROM privacy_consent_events e")) return { rows: [] };
      throw new Error("Unexpected pool query");
    },
    async connect() { return client; },
  };
}

test("privacy consent routes expose only the explicitly supported methods", () => {
  assert.equal(isPrivacyConsentRoute("/api/v1/privacy/consents"), true);
  assert.equal(isPrivacyConsentRoute("/api/v1/privacy/consents/aid_support/withdraw"), true);
  assert.equal(isPrivacyConsentRoute("/api/v1/privacy/consents/../withdraw"), false);
  assert.equal(isPrivacyConsentMethodAllowed("GET", "/api/v1/privacy/consents"), true);
  assert.equal(isPrivacyConsentMethodAllowed("DELETE", "/api/v1/privacy/consents"), false);
  assert.equal(isPrivacyConsentMethodAllowed("POST", "/api/v1/privacy/consents/aid_support/withdraw"), true);
});

test("privacy consent ledger is disabled by default and does not resolve a principal", async () => {
  let resolved = false;
  await withHandler({ enabled: false, principalResolver: async () => { resolved = true; return principal; } }, async (base) => {
    const response = await fetch(base + "/api/v1/privacy/consents");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "privacy_consent_ledger_disabled" });
  });
  assert.equal(resolved, false);
});

test("consent grant uses the authenticated subject, a registered document version and an append-only audit event", async () => {
  const pool = createPool();
  await withHandler({ enabled: true, pool, principalResolver: async () => principal }, async (base) => {
    const response = await fetch(base + "/api/v1/privacy/consents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        documentCode: "aid_support",
        documentVersion: "2026-11-19.1",
        choices: { contact_by_email: true, contact_by_phone: false },
      }),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).event.event_type, "granted");
  });
  const grantInsert = pool.calls.find((call) => call.sql.startsWith("INSERT INTO privacy_consent_events"));
  assert.equal(grantInsert.params[1], "subject-1");
  assert.deepEqual(JSON.parse(grantInsert.params[2]), { contact_by_email: true, contact_by_phone: false });
  const audit = pool.calls.find((call) => call.sql.startsWith("INSERT INTO audit_events"));
  assert.equal(audit.params[0], "subject-1");
  assert.equal(JSON.parse(audit.params[2]).documentSha256, "a".repeat(64));
  assert.equal(pool.calls.some((call) => call.sql.includes("UPDATE privacy_consent_events")), false);
});

test("consent grant rejects arbitrary payload fields and free-text data", async () => {
  const pool = createPool();
  await withHandler({ enabled: true, pool, principalResolver: async () => principal }, async (base) => {
    const response = await fetch(base + "/api/v1/privacy/consents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        documentCode: "aid_support",
        documentVersion: "2026-11-19.1",
        choices: { contact_by_email: true },
        medicalDiagnosis: "must never be accepted",
      }),
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_consent_payload" });
  });
  assert.equal(pool.calls.length, 0);
});

test("consent grant fails closed when the approved document version is absent", async () => {
  const pool = createPool({ document: false });
  await withHandler({ enabled: true, pool, principalResolver: async () => principal }, async (base) => {
    const response = await fetch(base + "/api/v1/privacy/consents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        documentCode: "aid_support",
        documentVersion: "2026-11-19.1",
        choices: { contact_by_email: true },
      }),
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "approved_consent_document_not_found" });
  });
});

test("consent history is scoped to the authenticated subject", async () => {
  const pool = createPool();
  await withHandler({ enabled: true, pool, principalResolver: async () => principal }, async (base) => {
    const response = await fetch(base + "/api/v1/privacy/consents");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { events: [] });
  });
  assert.equal(pool.calls[0].params[0], "subject-1");
});

test("withdrawal appends a new event linked to the active grant", async () => {
  const pool = createPool({ latestEvent: { id: "grant-1", event_type: "granted", document_id: "document-1" } });
  await withHandler({ enabled: true, pool, principalResolver: async () => principal }, async (base) => {
    const response = await fetch(base + "/api/v1/privacy/consents/aid_support/withdraw", { method: "POST" });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).event.event_type, "withdrawn");
  });
  const withdrawal = pool.calls.find((call) => call.sql.startsWith("INSERT INTO privacy_consent_events"));
  assert.equal(withdrawal.params[2], "grant-1");
  assert.equal(pool.calls.some((call) => call.sql.includes("UPDATE privacy_consent_events")), false);
});
