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
    required: true,
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
      warning: false,
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
    const state = r.ok ? "OK" : r.warning ? "WARNING" : r.required ? "FAIL" : "WARNING";
    return `- ${r.name}: ${state}; HTTP ${r.status}; final HTTPS=${r.httpsOk ? "yes" : "no"}; ${r.elapsed} мс; ${r.finalUrl || r.url}${r.error ? `; ${r.error}` : ""}`;
  }),
  "",
  "Проверка различает HTTP-доступность и HTTPS конечного адреса. Главный домен фонда обязан завершать переход по HTTPS; редирект GitHub Pages на HTTP фиксируется как предупреждение, а не как полностью безопасный результат.",
  ""
];
console.log(lines.join("\n"));
await import("node:fs/promises").then(fs => fs.appendFile("robot-team-report.md", "\n" + lines.join("\n")));
if (results.some(r => r.required && !r.ok)) process.exitCode = 1;
