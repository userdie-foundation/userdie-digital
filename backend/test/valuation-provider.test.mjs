import test from "node:test";
import assert from "node:assert/strict";
import { createValuationProvider, validateValuationInput } from "../src/valuation/valuation-provider.mjs";

const valid = {
  assetId: "ASSET-DEMO-001",
  assetClass: "property",
  title: "Демонстрационный объект",
  currency: "EUR",
  valuationDate: "2026-11-18",
  description: "Синтетическое описание объекта без персональных данных.",
  evidenceSummary: "Есть демонстрационный паспорт; правоустанавливающие документы и аналоги не представлены.",
  knownLimitations: "Только синтетические сведения.",
};

test("valuation input accepts only bounded, explicit fields", () => {
  assert.equal(validateValuationInput(valid).assetId, valid.assetId);
  assert.equal(validateValuationInput({ ...valid, extra: "not allowed" }), null);
  assert.equal(validateValuationInput({ ...valid, currency: "EURO" }), null);
  assert.equal(validateValuationInput({ ...valid, evidenceSummary: "" }), null);
});

test("provider is disabled when no server secret or model is configured", () => {
  assert.equal(createValuationProvider({}), null);
  assert.equal(createValuationProvider({ apiKey: "secret" }), null);
});

test("provider rejects non-HTTPS endpoints", () => {
  assert.throws(() => createValuationProvider({
    apiKey: "secret", model: "test", baseUrl: "http://provider.example/v1",
  }), /trusted HTTPS/);
});

test("provider sends request server-side and returns explicitly preliminary structured analysis", async () => {
  let request;
  const provider = createValuationProvider({
    apiKey: "server-only-secret",
    model: "valuation-test-model",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return {
        ok: true,
        async json() {
          return { choices: [{ message: { content: JSON.stringify({
            executiveSummary: "Недостаточно доказательств.",
            assetClass: "property",
            evidenceGaps: ["Право собственности"],
            contradictions: [],
            methodology: [],
            valueConclusion: { status: "not_estimable", currency: "EUR", low: null, central: null, high: null, explanation: "Нет подтверждённых аналогов." },
            risks: ["Недостаточность данных"],
            sourceRequirements: ["Документы о правах"],
            expertReviewChecklist: ["Проверить документы"],
          }) } }] };
        },
      };
    },
  });
  const result = await provider.analyze(valid);
  assert.equal(request.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(request.options.headers.Authorization, "Bearer server-only-secret");
  assert.equal(result.approvalRequired, true);
  assert.equal(result.valueConclusion.status, "not_estimable");
  assert.equal(result.assetId, valid.assetId);
});

test("provider fails closed on malformed provider output", async () => {
  const provider = createValuationProvider({
    apiKey: "secret", model: "test",
    fetchImpl: async () => ({ ok: true, async json() { return { choices: [{ message: { content: "{}" } }] }; } }),
  });
  await assert.rejects(provider.analyze(valid), /valuation_provider_invalid_response/);
});
