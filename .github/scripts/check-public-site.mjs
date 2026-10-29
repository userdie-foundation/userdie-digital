const targets = [
  { name: "GitHub Pages", url: "https://userdie-foundation.github.io/userdie-digital/", required: true },
  { name: "Домен фонда", url: "https://усердие.online/", required: false },
];

const results = [];
for (const target of targets) {
  const started = Date.now();
  try {
    const response = await fetch(target.url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
      headers: { "user-agent": "USERDIE-Digital-Uptime-Monitor/1.0" },
    });
    const elapsed = Date.now() - started;
    const ok = response.status >= 200 && response.status < 400;
    results.push({ ...target, ok, status: response.status, elapsed, finalUrl: response.url });
    await response.body?.cancel();
  } catch (error) {
    results.push({ ...target, ok: false, status: "NETWORK_ERROR", elapsed: Date.now() - started, error: error?.name || "Error" });
  }
}

const lines = [
  "## Проверка опубликованного сайта",
  "",
  ...results.map(r => `- ${r.name}: ${r.ok ? "OK" : r.required ? "FAIL" : "WARNING"}; HTTP ${r.status}; ${r.elapsed} мс; ${r.finalUrl || r.url}${r.error ? `; ${r.error}` : ""}`),
  "",
  "GitHub Pages — обязательная проверка. Пользовательский домен фиксируется отдельно: DNS/HTTPS могут настраиваться и не должны блокировать работу над репозиторием.",
  ""
];
console.log(lines.join("\n"));
await import("node:fs/promises").then(fs => fs.appendFile("robot-team-report.md", "\n" + lines.join("\n")));
if (results.some(r => r.required && !r.ok)) process.exitCode = 1;
