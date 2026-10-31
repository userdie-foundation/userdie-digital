import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const files = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
}
walk(path.join(root, "website"));
walk(path.join(root, "docs"));
walk(path.join(root, ".github", "workflows"));

const htmlFiles = files.filter(f => f.endsWith(".html"));
const workflowFiles = files.filter(f => f.endsWith(".yml") || f.endsWith(".yaml"));
const text = f => fs.readFileSync(f, "utf8");
const rel = f => path.relative(root, f).replaceAll(path.sep, "/");
const robots = [];
const add = (id, name, status, evidence, boundary) => robots.push({ id, name, status, evidence, boundary });

add("01", "Технический контролёр", "RUNNING", `${htmlFiles.length} HTML-файлов найдены; отдельный link/anchor checker запускается следующим шагом workflow.`, "Проверяет код и доступность, но не заменяет ручную проверку в браузере.");
add("02", "Координатор USERDIE Digital", "RUNNING", `Формирует единый ежедневный отчёт и сохраняет его артефактом GitHub Actions; при сбое обновляет issue.`, "Не принимает финансовые/юридические решения и не публикует изменения кода самостоятельно.");
add("03", "Интерфейс и доступность", "CHECKING", "", "Статическая проверка базовых признаков доступности; полноценное тестирование скринридером и на устройствах остаётся ручным.");
add("04", "Реестр активов и интеллектуальных ресурсов", "LIMITED", "", "Проверяет наличие страниц/документов и базовую полноту реестра; не оценивает активы без документов и источников.");
add("05", "Безопасность публичного репозитория", "RUNNING", "Запускает существующий сканер типовых признаков секретов в публичных файлах.", "Не является защитой от DDoS, не блокирует атаки и не гарантирует обнаружение всех уязвимостей.");
add("06", "Резервирование и восстановление", "LIMITED", "", "Проверяет наличие инструкции восстановления; не создаёт независимую резервную копию и не подтверждает восстановление.");
add("07", "Маршрут обращений заявителей", "LIMITED", "", "Проверяет наличие демонстрационного маршрута и предупреждения о персональных данных; не принимает реальные обращения.");
add("08", "Программы и партнёры", "LIMITED", "", "Проверяет наличие соответствующих страниц/ссылок; не ведёт внешние коммуникации и не подтверждает сведения о партнёрах.");
add("09", "Аналитика и аудит", "RUNNING", "", "Считает проверяемые показатели репозитория и сохраняет отчёт; не делает неподтверждённых финансовых выводов.");
add("10", "Международный юрист", "LIMITED", "", "Проверяет наличие правовых материалов, оговорок и контрольных точек международного контура; не оказывает юридические услуги, не подтверждает соответствие конкретной операции и не заменяет заключение профильного юриста.");

const readAllHtml = htmlFiles.map(f => ({ file: rel(f), body: text(f) }));
const missingAlt = [];
const missingMain = [];
const missingLang = [];
const noViewport = [];
for (const f of readAllHtml) {
  if (!/<html\b[^>]*\blang\s*=/.test(f.body)) missingLang.push(f.file);
  if (!/<meta\b[^>]*name=["']viewport["']/i.test(f.body)) noViewport.push(f.file);
  if (!/<main\b/i.test(f.body)) missingMain.push(f.file);
  for (const match of f.body.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = match[1];
    if (!/\balt\s*=/.test(attrs)) missingAlt.push(f.file);
  }
}
const accessible = missingAlt.length === 0 && missingMain.length === 0 && missingLang.length === 0 && noViewport.length === 0;
robots.find(r => r.id === "03").status = accessible ? "PASS" : "WARNING";
robots.find(r => r.id === "03").evidence = `HTML=${htmlFiles.length}; missing img alt=${missingAlt.length}; missing main=${missingMain.length}; missing lang=${missingLang.length}; missing viewport=${noViewport.length}.`;
robots.find(r => r.id === "04").evidence = `HTML-страниц=${htmlFiles.length}; docs/workflow files scanned=${files.length}. Наличие числовой оценки активов не предполагается без источников.`;
robots.find(r => r.id === "06").evidence = files.some(f => /restore|recovery|backup/i.test(rel(f))) ? "Найдены файлы/пути с упоминанием backup/recovery/restore; тест восстановления не выполнялся." : "Не найден явный файл с именем backup/recovery/restore; процедуру восстановления нужно документировать.";
robots.find(r => r.id === "07").evidence = readAllHtml.some(f => /applicant|заявител/i.test(f.file)) ? "Демонстрационная страница заявителя найдена." : "Страница заявителя не найдена.";
robots.find(r => r.id === "08").evidence = readAllHtml.some(f => /partner|партн/i.test(f.file)) ? "Демонстрационная страница партнёрского пространства найдена." : "Страница партнёров не найдена.";
robots.find(r => r.id === "09").evidence = `Проверено ${files.length} файлов; HTML=${htmlFiles.length}; workflow=${workflowFiles.length}; docs=${files.filter(f => rel(f).startsWith("docs/")).length}.`;
const legalFiles = files.filter(f => /legal|international|compliance|jurisdiction/i.test(rel(f)));
const legalPages = readAllHtml.filter(f => /legal|international|compliance|jurisdiction/i.test(f.file));
const legalSafeguards = legalPages.filter(f => /human|lawyer|юрист|проверка человеком|не является юридическим заключением|не заменяет/i.test(f.body));
const legalRobot = robots.find(r => r.id === "10");
legalRobot.status = legalFiles.length > 0 && legalSafeguards.length > 0 ? "LIMITED" : "WARNING";
legalRobot.evidence = `Правовых файлов/страниц=${legalFiles.length}; страниц с явной оговоркой о человеческой проверке=${legalSafeguards.length}. Автоматизированный правовой анализ и внешние юрисдикционные базы не подключены.`;

const failures = robots.filter(r => r.status === "WARNING" || r.status === "FAIL");
const warnings = robots.filter(r => r.status === "LIMITED" || r.status === "CHECKING");
const stamp = new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
const lines = [
  "# USERDIE DIGITAL — ежедневный отчёт команды роботов",
  "",
  `- Время: ${stamp}`,
  `- Commit: ${process.env.GITHUB_SHA || "локальный запуск"}`,
  `- Файлов в охвате: ${files.length}; HTML: ${htmlFiles.length}; workflow: ${workflowFiles.length}`,
  `- Роботов в реестре: ${robots.length}; предупреждения/ограничения: ${warnings.length}; проверки с предупреждением/ошибкой: ${failures.length}`,
  "",
  "| № | Робот | Статус | Проверяемое свидетельство | Граница полномочий |",
  "|---|---|---|---|---|",
  ...robots.map(r => `| ${r.id} | ${r.name} | ${r.status} | ${r.evidence.replaceAll("|", "\\|")} | ${r.boundary.replaceAll("|", "\\|")} |`),
  "",
  "## Проверка доступности",
  `- HTML без lang: ${missingLang.length ? missingLang.join(", ") : "нет"}`,
  `- HTML без viewport: ${noViewport.length ? noViewport.join(", ") : "нет"}`,
  `- HTML без main: ${missingMain.length ? missingMain.join(", ") : "нет"}`,
  `- Изображения без alt: ${missingAlt.length ? missingAlt.join(", ") : "нет"}`,
  "",
  "## Важные ограничения",
  "- Этот робот-комплекс проверяет публичный репозиторий и демонстрационные страницы. Он не является набором автономных ИИ-агентов, которые самостоятельно принимают решения или выполняют юридические, финансовые и пользовательские операции.",
  "- Реальные обращения, персональные данные, банковские данные и документы заявителей не загружаются и не обрабатываются этим workflow.",
  "- Проверка публичных файлов не заменяет внешнюю DDoS-защиту, анализ инфраструктуры, управление секретами, проверку прав доступа или независимый тест восстановления.",
  "- Международный юридический контур выполняет только проверку наличия правовых материалов и safeguards; он не формирует обязательные заключения и не заменяет юриста.",
  "- Ограниченные направления отмечены LIMITED намеренно, чтобы не выдавать демонстрационные интерфейсы за действующие сервисы.",
  ""
];
fs.writeFileSync("robot-team-report.md", lines.join("\n"));
fs.writeFileSync("robot-team-report.json", JSON.stringify({ generatedAt: stamp, commit: process.env.GITHUB_SHA || null, files: { scanned: files.length, html: htmlFiles.length, workflows: workflowFiles.length }, robots, accessibility: { missingAlt, missingMain, missingLang, noViewport } }, null, 2) + "\n");
console.log(lines.join("\n"));
if (failures.length) process.exitCode = 1;
