import fs from "node:fs";
import path from "node:path";

const root = path.resolve("website");
const stylesheet = path.join(root, "visual-enhancements.css");
const checkOnly = process.argv.includes("--check");

function collectHtml(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectHtml(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) found.push(full);
  }
  return found;
}

if (!fs.existsSync(stylesheet)) {
  console.error("Visual enhancement stylesheet is missing: website/visual-enhancements.css");
  process.exit(1);
}
const css = fs.readFileSync(stylesheet, "utf8");
const strippedCss = css.replace(/\/\*[\s\S]*?\*\//g, "");
let depth = 0;
for (const char of strippedCss) {
  if (char === "{") depth++;
  if (char === "}") depth--;
  if (depth < 0) break;
}
if (depth !== 0) {
  console.error("Visual enhancement stylesheet has unbalanced CSS braces.");
  process.exit(1);
}

const pages = collectHtml(root);
if (pages.length === 0) {
  console.error("No HTML pages found under website/.");
  process.exit(1);
}
let changed = 0;
for (const file of pages) {
  const original = fs.readFileSync(file, "utf8");
  if (!/<\/head\s*>/i.test(original)) {
    console.error(`HTML page has no closing </head>: ${path.relative(process.cwd(), file)}`);
    process.exitCode = 1;
    continue;
  }
  if (/visual-enhancements\.css/i.test(original)) continue;
  if (checkOnly) continue;
  const relativeCss = path.relative(path.dirname(file), stylesheet).split(path.sep).join("/");
  const tag = `  <link rel="stylesheet" href="${relativeCss}" data-userdie-visual-enhancements>\n`;
  const updated = original.replace(/<\/head\s*>/i, (closing) => tag + closing);
  fs.writeFileSync(file, updated, "utf8");
  changed++;
}
if (process.exitCode) process.exit(process.exitCode);
console.log(checkOnly
  ? `Visual enhancement assets valid; ${pages.length} HTML pages ready for build-time styling.`
  : `Applied visual enhancement stylesheet to ${changed} HTML pages (idempotent build step).`);
