import { readdir, readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve("website");
const htmlFiles = [];
const errors = [];
const ignoredTypes = new Set([
  "application/json",
  "application/ld+json",
  "importmap",
  "speculationrules",
]);

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(fullPath);
    else if (entry.isFile() && entry.name.endsWith(".html")) htmlFiles.push(fullPath);
  }
}

await walk(root);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "userdie-inline-js-"));

try {
  for (const source of htmlFiles) {
    const markup = await readFile(source, "utf8");
    const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
    let index = 0;

    for (const match of markup.matchAll(scriptPattern)) {
      const attributes = match[1];
      const code = match[2];
      if (/\bsrc\s*=/.test(attributes)) continue;

      const typeMatch = attributes.match(/\btype\s*=\s*(["'])(.*?)\1/i);
      const type = (typeMatch?.[2] || "text/javascript").trim().toLowerCase();
      if (ignoredTypes.has(type)) continue;
      if (!["text/javascript", "application/javascript", "module", ""].includes(type)) continue;
      if (!code.trim()) continue;

      index += 1;
      const extension = type === "module" ? ".mjs" : ".cjs";
      const tempFile = path.join(tempDir, `inline-${index}${extension}`);
      try {
        await writeFile(tempFile, code, "utf8");
        execFileSync(process.execPath, ["--check", tempFile], { stdio: "pipe" });
      } catch (error) {
        const detail = error?.stderr?.toString().trim() || error?.message || "unknown syntax error";
        errors.push(`${path.relative(root, source)}: inline script #${index}: ${detail}`);
      }
    }
  }
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

if (errors.length) {
  console.error("Inline JavaScript syntax check failed:");
  for (const error of errors) console.error(" - " + error);
  process.exitCode = 1;
} else {
  console.log(`Inline JavaScript syntax check passed: ${htmlFiles.length} HTML pages scanned.`);
}
