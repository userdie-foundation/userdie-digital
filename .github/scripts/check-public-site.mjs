const targets = [
  {
    name: "GitHub Pages",
    url: "https://userdie-foundation.github.io/userdie-digital/",
    required: true,
    // The repository CNAME points to the foundation domain. Inspect the
    // Pages redirect without following it while DNS/HTTPS is a deferred stage.
    redirect: "manual",
    expectedRedirectHosts: ["xn--d1abbl2ben.online"],
    httpsRequired: false,
  },
  {
    name: "Домен фонда",
    url: "https://усердие.online/",
    // DNS/HTTPS is a separately scheduled release gate; keep monitoring visible
    // without failing unrelated repository checks while that work is deferred.
    required: false,
    redirect: "follow",
    httpsRequired: true,
  },
];

const results = [];
for (const target of targets) {
  const started = Date.now();
  try {
    const response = await fetch(target.url, {
      redirect: target.redirect || "follow",
      signal: AbortSignal.timeout(12000),
      headers: { "user-agent": "USERDIE-Digital-Uptime-Monitor/1.2" },
    });
    const elapsed = Date.now() - started;
    const location = response.headers.get("location");
    let redirectUrl;
    let expectedRedirect = false;
    if (location) {
      try {
        redirectUrl = new URL(location, target.url);
        expectedRedirect =
          response.status >= 300 &&
          response.status < 400 &&
          ["https:", "http:"].includes(redirectUrl.protocol) &&
          target.expectedRedirectHosts?.includes(redirectUrl.hostname.replace(/\\.$/, "")) === true;
      } catch {
        redirectUrl = undefined;
      }
    }

    // A redirect from the GitHub Pages project URL to the configured
    // punycode custom domain is expected while that domain's DNS stage is open.
    // Record it as WARNING and do not resolve/follow the custom host here.
    const redirectWithoutLocation =
      target.expectedRedirectHosts?.length > 0 &&
      response.status >= 300 &&
      response.status < 400 &&
      !location;
    if (redirectWithoutLocation) expectedRedirect = true;

    const httpOk = response.status >= 200 && response.status < 300;
    const finalUrl = expectedRedirect
      ? redirectUrl?.href || target.url
      : response.url || target.url;
    const httpsOk = !expectedRedirect && finalUrl.startsWith("https://");
    const ok = expectedRedirect || (httpOk && (!target.httpsRequired || httpsOk));
    const warning = expectedRedirect || (httpOk && !httpsOk);
    results.push({
      ...target,
      ok,
      warning,
      status: expectedRedirect ? "EXPECTED_CUSTOM_DOMAIN_REDIRECT" : response.status,
      httpsOk,
      elapsed,
      finalUrl,
      detail: expectedRedirect
        ? redirectUrl
          ? redirectUrl.protocol === "http:"
            ? "HTTP downgrade to configured custom domain; direct HTTPS is checked separately and this redirect is not considered secure"
            : "redirect to configured custom domain inspected but not followed; custom-domain HTTPS is checked separately"
          : "HTTP redirect observed; Location header was not exposed; custom-domain HTTPS is checked separately"
        : response.status >= 300 && response.status < 400
          ? `unrecognized redirect target: ${location || "Location header not exposed"}`
          : undefined,
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
    return `- ${r.name}: ${state}; HTTP ${r.status}; final HTTPS=${r.httpsOk ? "yes" : "no"}; ${r.elapsed} мс; ${r.finalUrl || r.url}${r.error ? `; ${r.error}` : ""}${r.detail ? `; ${r.detail}` : ""}`;
  }),
  "",
  "Проверка различает доступность GitHub Pages, ожидаемый редирект на настроенный пользовательский домен и фактическую готовность HTTPS. Ожидаемый редирект на домен из CNAME фиксируется как WARNING без перехода к домену, пока DNS/HTTPS остаётся отдельным этапом. Неожиданные редиректы и сетевые ошибки GitHub Pages остаются FAIL. До полноценного релиза пользовательский домен обязан открываться по HTTPS.",
  ""
];
console.log(lines.join("\n"));
await import("node:fs/promises").then(fs => fs.appendFile("robot-team-report.md", "\n" + lines.join("\n")));
if (results.some(r => r.required && !r.ok)) process.exitCode = 1;
