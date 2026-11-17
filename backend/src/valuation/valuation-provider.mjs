const MAX_EVIDENCE_CHARS = 8000;
const ALLOWED_ASSET_CLASSES = new Set(["financial", "property", "intellectual", "other"]);

function safeText(value, max, required = false) {
  if (typeof value !== "string") return required ? null : "";
  const text = value.trim();
  if (required && !text) return null;
  return text.slice(0, max);
}

export function validateValuationInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const allowed = new Set(["assetId", "assetClass", "title", "currency", "valuationDate", "description", "evidenceSummary", "knownLimitations"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) return null;
  const assetId = safeText(input.assetId, 100, true);
  const title = safeText(input.title, 240, true);
  const assetClass = safeText(input.assetClass, 30, true);
  const currency = safeText(input.currency, 3, true);
  const description = safeText(input.description, 2000, true);
  const evidenceSummary = safeText(input.evidenceSummary, MAX_EVIDENCE_CHARS, true);
  const valuationDate = safeText(input.valuationDate, 10, true);
  const knownLimitations = safeText(input.knownLimitations, 1500);
  if (!assetId || !title || !ALLOWED_ASSET_CLASSES.has(assetClass) ||
      !/^[A-Z]{3}$/.test(currency) || !description || !evidenceSummary ||
      !/^\d{4}-\d{2}-\d{2}$/.test(valuationDate)) return null;
  return { assetId, assetClass, title, currency, valuationDate, description, evidenceSummary, knownLimitations };
}

export function createValuationProvider({ apiKey, baseUrl = "https://api.openai.com/v1", model, fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  if (!apiKey || !model || typeof fetchImpl !== "function") return null;
  let endpoint;
  try {
    const normalizedBaseUrl = String(baseUrl).endsWith("/") ? String(baseUrl).slice(0, -1) : String(baseUrl);
    endpoint = new URL(normalizedBaseUrl + "/chat/completions");
  } catch {
    throw new Error("Valuation provider URL is invalid");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    throw new Error("Valuation provider must use a trusted HTTPS endpoint");
  }

  return {
    async analyze(asset) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            temperature: 0.1,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: "You are USERDIE Valuation Intelligence, a preliminary analytical assistant. Never invent market prices, comparables, transactions, legal facts, document verification, citations, or source URLs. Separate facts supplied by the user from assumptions and missing evidence. If evidence is insufficient, do not produce a monetary estimate; explain what is missing. Recommend potentially applicable income, market/comparative, or cost approaches only with reasons and limitations. Do not make legal determinations or approve a valuation. Return JSON only with keys: executiveSummary (string), assetClass (string), evidenceGaps (array of strings), contradictions (array of strings), methodology (array of objects with approach, applicability, rationale, requiredInputs), valueConclusion (object with status, currency, low, central, high, explanation), risks (array of strings), sourceRequirements (array of strings), expertReviewChecklist (array of strings). valueConclusion.status must be 'not_estimable' unless sufficient verifiable market and asset data is explicitly present; never infer numerical values."
              },
              {
                role: "user",
                content: JSON.stringify({
                  task: "Prepare a preliminary evidence-led review. Do not issue an appraisal or final valuation.",
                  asset,
                }),
              },
            ],
          }),
        });
        if (!response.ok) throw new Error("valuation_provider_unavailable");
        const payload = await response.json();
        const content = payload?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.length > 20000) throw new Error("valuation_provider_invalid_response");
        let analysis;
        try { analysis = JSON.parse(content); } catch { throw new Error("valuation_provider_invalid_response"); }
        if (!analysis || typeof analysis !== "object" || Array.isArray(analysis) ||
            typeof analysis.executiveSummary !== "string" ||
            !Array.isArray(analysis.evidenceGaps) ||
            !Array.isArray(analysis.contradictions) ||
            !Array.isArray(analysis.methodology) ||
            !analysis.valueConclusion || typeof analysis.valueConclusion !== "object" ||
            Array.isArray(analysis.valueConclusion) ||
            typeof analysis.valueConclusion.explanation !== "string" ||
            !Array.isArray(analysis.risks) ||
            !Array.isArray(analysis.sourceRequirements) ||
            !Array.isArray(analysis.expertReviewChecklist)) {
          throw new Error("valuation_provider_invalid_response");
        }
        const boundedStringList = (items) => {
          if (items.length > 30 || items.some((item) => typeof item !== "string")) {
            throw new Error("valuation_provider_invalid_response");
          }
          return items.map((item) => item.trim().slice(0, 500));
        };
        const methodology = analysis.methodology.map((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item) ||
              typeof item.approach !== "string" ||
              typeof item.applicability !== "string" ||
              typeof item.rationale !== "string" ||
              !Array.isArray(item.requiredInputs)) {
            throw new Error("valuation_provider_invalid_response");
          }
          return {
            approach: item.approach.trim().slice(0, 120),
            applicability: item.applicability.trim().slice(0, 500),
            rationale: item.rationale.trim().slice(0, 1000),
            requiredInputs: boundedStringList(item.requiredInputs),
          };
        });
        if (methodology.length > 10 || analysis.executiveSummary.length > 4000 ||
            analysis.valueConclusion.explanation.length > 2000) {
          throw new Error("valuation_provider_invalid_response");
        }
        // No verified evidence registry is connected yet. Therefore the server,
        // not the model prompt, unconditionally prevents monetary conclusions.
        return {
          executiveSummary: analysis.executiveSummary.trim(),
          assetClass: asset.assetClass,
          evidenceGaps: boundedStringList(analysis.evidenceGaps),
          contradictions: boundedStringList(analysis.contradictions),
          methodology,
          valueConclusion: {
            status: "not_estimable",
            currency: asset.currency,
            low: null,
            central: null,
            high: null,
            explanation: analysis.valueConclusion.explanation.trim(),
          },
          risks: boundedStringList(analysis.risks),
          sourceRequirements: boundedStringList(analysis.sourceRequirements),
          expertReviewChecklist: boundedStringList(analysis.expertReviewChecklist),
          assetId: asset.assetId,
          generatedAt: new Date().toISOString(),
          reviewStatus: "preliminary_ai_analysis",
          approvalRequired: true,
          disclaimer: "Предварительный аналитический материал. Не является независимой оценкой, юридическим заключением или утверждённой стоимостью. Денежный вывод заблокирован до подключения проверяемых источников и экспертной проверки.",
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
