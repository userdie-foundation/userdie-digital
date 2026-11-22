import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync("website/prototype/workspace.html", "utf8");

assert.match(html, /id="document-meta-fields"/, "document-specific metadata form must exist");
for (const id of [
  "document-type", "document-number", "document-date", "document-issuer",
  "document-signatory", "document-original-status", "document-signature-check",
  "document-version", "document-evidence-status", "document-access-level",
  "document-validity", "document-file-state", "document-public-use",
  "document-appendices", "document-register-search", "document-register-status",
  "document-register-contour", "document-register-summary"
]) {
  assert.ok(html.includes('id="' + id + '"'), "document register control must exist: " + id);
}
assert.match(html, /const documentMeta=objectType==="document"\?\{[\s\S]*?registrationNumber:[\s\S]*?evidenceStatus:/,
  "document metadata must be collected only for document objects");
assert.match(html, /hasDuplicateDocumentRegistrationNumber\(documentMeta\.registrationNumber,objects\)/,
  "document creation must call the registration-number uniqueness guard");
const helperMatch = html.match(/function hasDuplicateDocumentRegistrationNumber\(registrationNumber,entries\)\{[\s\S]*?\}/);
assert.ok(helperMatch, "registration-number uniqueness helper must exist");
const hasDuplicateDocumentRegistrationNumber = vm.runInNewContext("(" + helperMatch[0] + ")");
const existingDocument = [{ type: "document", documentMeta: { registrationNumber: "REG-2026-01" } }];
assert.equal(hasDuplicateDocumentRegistrationNumber(" reg-2026-01 ", existingDocument), true,
  "registration-number comparison must trim whitespace and ignore case");
assert.equal(hasDuplicateDocumentRegistrationNumber("REG-2026-02", existingDocument), false,
  "a different registration number must be accepted");
assert.equal(hasDuplicateDocumentRegistrationNumber("   ", existingDocument), false,
  "an empty optional registration number must not be treated as a duplicate");
assert.equal(hasDuplicateDocumentRegistrationNumber("REG-2026-01", existingDocument.filter(item => item.id !== "DEMO-001")), false,
  "an edited document must be excluded from its own duplicate-number check");
assert.match(html, /function renderDocumentRegister\(\)[\s\S]*?document-register-search[\s\S]*?document-register-status[\s\S]*?document-register-contour/,
  "document register must filter by search, evidence status and organizational contour");
assert.match(html, /function syncDocumentFields\(\)[\s\S]*?field\.disabled=!active/,
  "document metadata fields must be disabled when the selected object is not a document");
assert.match(html, /function saveObjects\(\)\{[^}]*localStorage\.setItem\("userdie-demo-objects-v1"/,
  "document metadata must use the existing browser-local demo storage");
assert.match(html, /Файлы не загружаются и не хранятся/,
  "document register must disclose that file upload and storage are not implemented");
assert.match(html, /не подтверждает подлинность документа, подпись или юридическую силу/,
  "document register must not imply legal verification or authenticity");
assert.match(html, /Публичное использование допускается только после документальной проверки и отдельного разрешения/,
  "public use must remain gated by documentary review and separate approval");
assert.match(html, /\.document-register-filters[\s\S]*?@media\(max-width:760px\)/,
  "document register filters must have a narrow-screen layout");
assert.match(html, /@media\(max-width:420px\)\{\.document-record-grid\{grid-template-columns:1fr\}\}\s*\.document-register-filters\{/,
  "document register filter base styles must not be nested inside the 420px media query");

assert.ok(html.includes("function beginDocumentEdit(id)") && html.includes("setDocumentFormMode(true)"),
  "document cards must support editing existing metadata through the shared object form");
assert.ok(html.includes("revisionHistory.unshift({at:new Date().toISOString(),version:previous.documentMeta.version"),
  "editing must preserve the previous document revision");
assert.ok(html.includes("function cancelDocumentEdit()") && html.includes("editingDocumentId=null"),
  "document editing must be cancellable without saving");
assert.ok(html.includes("document-revision-history") && html.includes("автор, полномочия и серверная неизменяемость не подтверждаются"),
  "revision history must disclose local demo-only limitations");

console.log("Document register checks passed: create/edit, duplicate guard, revision history, filters, local-only storage, legal disclaimers and responsive layout.");
