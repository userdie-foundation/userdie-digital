import assert from "node:assert/strict";
import fs from "node:fs";

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
assert.match(html, /documentMeta\?\.registrationNumber[\s\S]*?objects\.some\(item=>item\.type==="document"/,
  "registration number must be unique within the demonstration document register");
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

console.log("Document register checks passed: metadata form, unique registration number, filters, local-only storage, legal disclaimers and responsive filter layout.");
