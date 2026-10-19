import { readdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve("website");
const htmlFiles = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(fullPath);
    else if (entry.isFile() && entry.name.endsWith(".html")) htmlFiles.push(fullPath);
  }
}

function attributes(markup, name) {
  const values = [];
  const pattern = new RegExp("\\b" + name + "\\s*=\\s*(['\"])(.*?)\\1", "gi");
  for (const match of markup.matchAll(pattern)) values.push(match[2].trim());
  return values;
}

function ids(markup) {
  return new Set([
    ...attributes(markup, "id"),
    ...attributes(markup, "name"),
  ]);
}

const errors = [];
await walk(root);

for (const source of htmlFiles) {
  const markup = await readFile(source, "utf8");
  const sourceIds = ids(markup);

  for (const raw of [...attributes(markup, "href"), ...attributes(markup, "src")]) {
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) continue;

    let pathname;
    let fragment;
    try {
      const hashIndex = raw.indexOf("#");
      fragment = hashIndex >= 0 ? decodeURIComponent(raw.slice(hashIndex + 1)) : "";
      const beforeHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
      pathname = decodeURIComponent(beforeHash.split("?")[0]);
    } catch {
      errors.push(`${path.relative(root, source)}: invalid URL encoding in "${raw}"`);
      continue;
    }

    let target = pathname
      ? (pathname.startsWith("/") ? path.resolve(root, "." + pathname) : path.resolve(path.dirname(source), pathname))
      : source;
    if (target.endsWith(path.sep)) target = path.join(target, "index.html");
    try {
      await access(target);
    } catch {
      errors.push(`${path.relative(root, source)}: missing local target "${raw}"`);
      continue;
    }

    if (fragment && target.endsWith(".html")) {
      const targetMarkup = target === source ? markup : await readFile(target, "utf8");
      if (!ids(targetMarkup).has(fragment)) {
        errors.push(`${path.relative(root, source)}: missing anchor "${fragment}" in "${path.relative(root, target)}"`);
      }
    }
  }
}

if (errors.length) {
  console.error("Static website link check failed:");
  for (const error of errors) console.error(" - " + error);
  process.exitCode = 1;
} else {
  console.log(`Static website link check passed: ${htmlFiles.length} HTML pages scanned.`);
}
