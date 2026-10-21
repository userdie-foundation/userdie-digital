import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const roots = ["website", "docs", ".github/workflows"];
const files = [];
const patterns = [
  ["private key header", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["OpenAI-style secret key", /\bsk-[A-Za-z0-9_-]{24,}\b/],
  ["Telegram bot token", /\b\d{6,}:[A-Za-z0-9_-]{30,}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{30,}\b/],
];

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (entry.isFile() && !/\.(?:png|jpe?g|gif|webp|ico|pdf|zip)$/i.test(entry.name)) files.push(file);
  }
}

for (const root of roots) await walk(root);
const findings = [];
for (const file of files) {
  const content = await readFile(file, "utf8");
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) findings.push(file + ": possible " + label);
  }
}
if (findings.length) {
  console.error("Possible public secrets found. Review before publishing:");
  for (const finding of findings) console.error(" - " + finding);
  process.exitCode = 1;
} else {
  console.log("Public secret-pattern scan passed: " + files.length + " text files checked.");
}
