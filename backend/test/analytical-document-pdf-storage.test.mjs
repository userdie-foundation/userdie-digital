import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  persistAnalyticalDocumentPdf,
  readStoredAnalyticalDocumentPdf,
  removeStoredAnalyticalDocumentPdf,
} from "../src/analytical-document-pdf.mjs";

async function withStorage(run) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "userdie-pdf-storage-"));
  const directory = path.join(parent, "private-pdfs");
  try {
    await run(directory);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

const samplePdf = Buffer.from("%PDF-1.7\nSynthetic USERDIE PDF fixture\n%%EOF\n", "ascii");

test("PDF persistence creates a private directory and a private, integrity-described file", async (t) => {
  await withStorage(async (directory) => {
    const stored = await persistAnalyticalDocumentPdf({ directory, bytes: samplePdf });

    assert.match(stored.key, /^[0-9a-f-]{36}\.pdf$/i);
    assert.equal(path.dirname(stored.target), directory);
    assert.equal(stored.byteSize, samplePdf.length);
    assert.match(stored.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(await readFile(stored.target), samplePdf);

    if (process.platform !== "win32") {
      const directoryMode = (await stat(directory)).mode & 0o777;
      const fileMode = (await stat(stored.target)).mode & 0o777;
      assert.equal(directoryMode & 0o077, 0, "private PDF directory must not grant group/other access");
      assert.equal(fileMode & 0o077, 0, "private PDF file must not grant group/other access");
    } else {
      t.skip("POSIX permission bits are not portable to Windows");
    }
  });
});

test("PDF retrieval accepts only a storage key, not a caller-controlled path", async () => {
  await withStorage(async (directory) => {
    await assert.rejects(
      readStoredAnalyticalDocumentPdf({
        directory,
        key: "../outside.pdf",
        sha256: "a".repeat(64),
        byteSize: 1,
      }),
      /Invalid PDF storage key/,
    );
  });
});

test("PDF retrieval rejects bytes whose SHA-256 digest does not match the artifact registry", async () => {
  await withStorage(async (directory) => {
    const stored = await persistAnalyticalDocumentPdf({ directory, bytes: samplePdf });
    await writeFile(stored.target, Buffer.from("%PDF-1.7\nTampered fixture\n%%EOF\n", "ascii"));

    await assert.rejects(
      readStoredAnalyticalDocumentPdf({
        directory,
        key: stored.key,
        sha256: stored.sha256,
        byteSize: stored.byteSize,
      }),
      /integrity check failed/,
    );
  });
});

test("PDF retrieval rejects a byte-size mismatch even when the supplied key is valid", async () => {
  await withStorage(async (directory) => {
    const stored = await persistAnalyticalDocumentPdf({ directory, bytes: samplePdf });

    await assert.rejects(
      readStoredAnalyticalDocumentPdf({
        directory,
        key: stored.key,
        sha256: stored.sha256,
        byteSize: stored.byteSize + 1,
      }),
      /integrity check failed/,
    );
  });
});

test("PDF artifact removal deletes only the requested stored file", async () => {
  await withStorage(async (directory) => {
    const stored = await persistAnalyticalDocumentPdf({ directory, bytes: samplePdf });
    await removeStoredAnalyticalDocumentPdf(stored.target);
    await assert.rejects(stat(stored.target), { code: "ENOENT" });
  });
});

test("PDF persistence tightens permissions on an already-existing storage directory", async (t) => {
  await withStorage(async (directory) => {
    await mkdir(directory, { recursive: true, mode: 0o755 });
    if (process.platform === "win32") {
      t.skip("POSIX permission bits are not portable to Windows");
      return;
    }
    await chmod(directory, 0o755);
    await persistAnalyticalDocumentPdf({ directory, bytes: samplePdf });
    const directoryMode = (await stat(directory)).mode & 0o777;
    assert.equal(directoryMode, 0o700, "existing PDF storage directory must be restricted to its owner");
  });
});


test("PDF retrieval rejects a symlink in place of a stored artifact", async (t) => {
  await withStorage(async (directory) => {
    if (process.platform === "win32") {
      t.skip("Symlink creation is not portable to all Windows runners");
      return;
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const outside = path.join(path.dirname(directory), "outside.pdf");
    await writeFile(outside, samplePdf, { mode: 0o600 });
    const key = "123e4567-e89b-42d3-a456-426614174000.pdf";
    await symlink(outside, path.join(directory, key));
    await assert.rejects(
      readStoredAnalyticalDocumentPdf({
        directory,
        key,
        sha256: "a".repeat(64),
        byteSize: samplePdf.length,
      }),
      /private regular file/,
    );
  });
});

test("PDF storage rejects a symlink as the configured storage directory", async (t) => {
  await withStorage(async (directory) => {
    if (process.platform === "win32") {
      t.skip("Symlink creation is not portable to all Windows runners");
      return;
    }
    const realDirectory = path.join(path.dirname(directory), "real-private-pdfs");
    await mkdir(realDirectory, { recursive: true, mode: 0o700 });
    await symlink(realDirectory, directory);
    await assert.rejects(
      persistAnalyticalDocumentPdf({ directory, bytes: samplePdf }),
      /real directory/,
    );
  });
});

test("PDF persistence rejects empty or non-Buffer artifact bytes", async () => {
  await withStorage(async (directory) => {
    await assert.rejects(
      persistAnalyticalDocumentPdf({ directory, bytes: Buffer.alloc(0) }),
      /Non-empty PDF bytes/,
    );
    await assert.rejects(
      persistAnalyticalDocumentPdf({ directory, bytes: "not a buffer" }),
      /Non-empty PDF bytes/,
    );
  });
});
