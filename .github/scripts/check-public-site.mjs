const targets = [
  {
    name: "GitHub Pages",
    url: "https://userdie-foundation.github.io/userdie-digital/",
    required: true,
    // GitHub Pages may redirect the project URL to the configured custom domain.
    // Record the final protocol separately so a downgrade is never labelled fully secure.
    httpsRequired: false,
  },
  {
    name: "Домен фонда",
    url: "https://усердие.online/",
    // DNS/HTTPS is a separately scheduled release gate; keep monitoring visible
    // without failing unrelated repository checks while that work is deferred.
    required: false,
    httpsRequired: true,
  },
];

const results = [];
for (const target of targets) {
  const started = Date.now();
  try {
    const response = await fetch(target.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: { "user-agent": "USERDIE-Digital-Uptime-Monitor/1.1" },
    });
    const elapsed = Date.now() - started;
    const httpOk = response.status >= 200 && response.status < 400;
    const finalUrl = response.url || target.url;
    const httpsOk = finalUrl.startsWith("https://");
    const ok = httpOk && (!target.httpsRequired || httpsOk);
    const warning = httpOk && !httpsOk;
    results.push({
      ...target,
      ok,
      warning,
      status: response.status,
      httpsOk,
      elapsed,
      finalUrl,
    });
    await response.body?.cancel();
  } catch (error) {
    results.push({
      ...target,
      ok: false,
      warning: !target.required,
      status: "NETWORK_ERROR",
      httpsOk: false,
      elapsed: Date.now() - started,
      error: error?.name || "Error",
    });
  }
}

const lines = [
  "## Проверка опубликованного сайта и HTTPS",
  "",
  ...results.map(r => {
    const state = r.warning ? "WARNING" : r.ok ? "OK" : r.required ? "FAIL" : "WARNING";
    return `- ${r.name}: ${state}; HTTP ${r.status}; final HTTPS=${r.httpsOk ? "yes" : "no"}; ${r.elapsed} мс; ${r.finalUrl || r.url}${r.error ? `; ${r.error}` : ""}`;
  }),
  "",
  "Проверка различает HTTP-доступность и HTTPS конечного адреса. До отдельного этапа DNS/HTTPS домен фонда контролируется как WARNING и не блокирует независимые проверки репозитория. Перед объявлением полноценного релиза пользовательский домен обязан открываться по HTTPS; HTTP-редирект GitHub Pages также остаётся предупреждением, а не подтверждением безопасного HTTPS.",
  ""
];
console.log(lines.join("\n"));
await import("node:fs/promises").then(fs => fs.appendFile("robot-team-report.md", "\n" + lines.join("\n")));
if (results.some(r => r.required && !r.ok)) process.exitCode = 1;
