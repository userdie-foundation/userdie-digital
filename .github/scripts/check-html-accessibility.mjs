import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("website");
const htmlFiles = [];
const errors = [];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(fullPath);
    else if (entry.isFile() && entry.name.endsWith(".html")) htmlFiles.push(fullPath);
  }
}

function has(markup, pattern) {
  return pattern.test(markup);
}

await walk(root);

for (const file of htmlFiles) {
  const markup = await readFile(file, "utf8");
  const relative = path.relative(root, file);

  if (!has(markup, /<html\b[^>]*\blang\s*=\s*(["'])[^"']+\1/i)) {
    errors.push(`${relative}: missing document language (html lang)`);
  }
  if (!has(markup, /<title\b[^>]*>\s*[^<\s][\s\S]*?<\/title\s*>/i)) {
    errors.push(`${relative}: missing non-empty document title`);
  }
  if (!has(markup, /<meta\b(?=[^>]*\bname\s*=\s*(["'])viewport\1)(?=[^>]*\bcontent\s*=\s*(["'])[^"']*width=device-width)[^>]*>/i)) {
    errors.push(`${relative}: missing responsive viewport meta`);
  }
  if (!has(markup, /<main\b/i)) {
    errors.push(`${relative}: missing main content landmark`);
  }

  for (const match of markup.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt\s*=\s*(["'])[\s\S]*?\1/i.test(match[0])) {
      errors.push(`${relative}: image missing alt attribute: ${match[0].slice(0, 100)}`);
    }
  }
}

if (errors.length) {
  console.error("HTML accessibility baseline failed:");
  for (const error of errors) console.error(" - " + error);
  process.exitCode = 1;
} else {
  console.log(`HTML accessibility baseline passed: ${htmlFiles.length} pages checked for language, title, viewport, main landmark and image alternatives.`);
}
