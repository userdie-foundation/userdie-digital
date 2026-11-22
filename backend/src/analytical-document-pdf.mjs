import PDFDocument from "pdfkit";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const LABELS = {
  summary: "Резюме",
  executive_summary: "Краткое резюме",
  purpose: "Цель анализа",
  scope: "Объём анализа",
  methodology: "Методология",
  methods: "Методы",
  assumptions: "Допущения",
  sources: "Источники информации",
  evidence: "Доказательная база",
  comparables: "Сопоставимые объекты",
  market: "Рыночный анализ",
  market_analysis: "Анализ рынка",
  valuation: "Оценка стоимости",
  valuation_range: "Диапазон стоимости",
  conclusion: "Вывод",
  limitations: "Ограничения",
  risks: "Риски",
  capital_structure: "Структура капитала",
  debt: "Долговая нагрузка",
  cash_flow: "Денежный поток",
  dcf: "DCF-анализ",
  multiples: "Сравнительный анализ мультипликаторов",
  currency: "Валюта",
  date: "Дата",
};

function humanize(value) {
  const key = String(value).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return LABELS[key.toLowerCase().replace(/\s+/g, "_")] ??
    key.charAt(0).toLocaleUpperCase("ru-RU") + key.slice(1);
}

function scalarText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function appendValue(doc, value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "object" && item !== null) appendValue(doc, item, depth + 1);
      else {
        const text = scalarText(item);
        if (text) doc.font("Body").fontSize(10).fillColor("#263238").text("• " + text, { indent: 12, paragraphGap: 3 });
      }
    }
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (child === null || child === undefined || child === "") continue;
      if (typeof child === "object") {
        doc.moveDown(0.35);
        doc.font("BodyBold").fontSize(10.5).fillColor("#173d32").text(humanize(key), { paragraphGap: 3 });
        appendValue(doc, child, depth + 1);
      } else {
        const text = scalarText(child);
        if (text) doc.font("Body").fontSize(10).fillColor("#263238").text(humanize(key) + ": " + text, { paragraphGap: 4 });
      }
    }
    return;
  }
  const text = scalarText(value);
  if (text) doc.font("Body").fontSize(10).fillColor("#263238").text(text, { paragraphGap: 4 });
}

function renderContent(doc, content) {
  for (const [key, value] of Object.entries(content ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    doc.moveDown(0.65);
    doc.font("BodyBold").fontSize(12).fillColor("#174b3b").text(humanize(key), { paragraphGap: 5 });
    appendValue(doc, value);
  }
}

export async function renderAnalyticalDocumentPdf({
  document,
  version,
  issuedAt,
  fontRegularPath = "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
  fontBoldPath = "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
}) {
  if (!document || !version || !version.content || !/^[a-f0-9]{64}$/.test(version.content_sha256 ?? "")) {
    throw new TypeError("A valid issued document and immutable content version are required");
  }
  const [regularExists, boldExists] = await Promise.all([
    readFile(fontRegularPath),
    readFile(fontBoldPath),
  ]);
  if (!regularExists.length || !boldExists.length) throw new Error("PDF font files are empty");

  const pdf = new PDFDocument({
    size: "A4",
    margins: { top: 62, bottom: 58, left: 58, right: 58 },
    bufferPages: true,
    compress: true,
    info: {
      Title: document.title,
      Author: "USERDIE Digital | Фонд «УСЕРДИЕ»",
      Subject: "Выпущенное аналитическое заключение",
      Keywords: "USERDIE, УСЕРДИЕ, аналитическое заключение",
      CreationDate: new Date(issuedAt ?? document.issued_at ?? Date.now()),
    },
  });
  pdf.registerFont("Body", fontRegularPath);
  pdf.registerFont("BodyBold", fontBoldPath);

  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
  });

  pdf.font("Body").fontSize(9).fillColor("#64746d")
    .text("USERDIE DIGITAL  |  БЛАГОТВОРИТЕЛЬНЫЙ ФОНД «УСЕРДИЕ»", { characterSpacing: 0.4 });
  pdf.moveDown(0.8);
  pdf.moveTo(58, pdf.y).lineTo(537, pdf.y).lineWidth(1.2).strokeColor("#b69a52").stroke();
  pdf.moveDown(1.1);
  pdf.font("BodyBold").fontSize(19).fillColor("#173d32")
    .text("АНАЛИТИЧЕСКОЕ ЗАКЛЮЧЕНИЕ", { align: "left" });
  pdf.moveDown(0.4);
  pdf.font("BodyBold").fontSize(14).fillColor("#202b27").text(document.title, { paragraphGap: 6 });
  pdf.moveDown(0.6);

  const metadata = [
    ["Регистрационный номер", document.document_number],
    ["Тип документа", humanize(document.document_type)],
    ["Объект / актив", document.asset_reference || "Не указан"],
    ["Контур", humanize(document.organizational_contour)],
    ["Дата выпуска", new Date(issuedAt ?? document.issued_at ?? Date.now()).toLocaleDateString("ru-RU", { timeZone: "UTC" })],
    ["Независимый проверяющий", document.approved_by_name || "Независимая проверка подтверждена в реестре"],
    ["Дата согласования", document.approved_at ? new Date(document.approved_at).toLocaleDateString("ru-RU", { timeZone: "UTC" }) : "—"],
    ["Версия содержания", String(version.version_number)],
  ];
  for (const [label, value] of metadata) {
    pdf.font("BodyBold").fontSize(9.5).fillColor("#53645d").text(label + ": ", { continued: true });
    pdf.font("Body").fontSize(9.5).fillColor("#202b27").text(String(value ?? "—"));
  }

  pdf.moveDown(0.8);
  pdf.moveTo(58, pdf.y).lineTo(537, pdf.y).lineWidth(0.6).strokeColor("#d7ddd8").stroke();
  pdf.moveDown(0.7);
  renderContent(pdf, version.content);

  pdf.moveDown(1);
  pdf.font("BodyBold").fontSize(9).fillColor("#173d32").text("КОНТРОЛЬ ЦЕЛОСТНОСТИ");
  pdf.font("Body").fontSize(8).fillColor("#52635b")
    .text("SHA-256 версии содержания: " + version.content_sha256, { width: 479 });
  pdf.moveDown(0.5);
  pdf.font("Body").fontSize(8).fillColor("#64746d")
    .text("Документ сформирован из неизменяемой версии, закреплённой при независимом согласовании и выпуске. Любое изменение содержания требует создания новой версии и повторного прохождения процедуры согласования.", { align: "justify" });

  const pages = pdf.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    pdf.switchToPage(index);
    pdf.save();
    pdf.font("Body").fontSize(8).fillColor("#77847e");
    pdf.moveTo(58, 779).lineTo(537, 779).lineWidth(0.5).strokeColor("#d7ddd8").stroke();
    pdf.text("USERDIE Digital  •  Контролируемый экземпляр", 58, 787, { width: 360, lineBreak: false });
    pdf.text("Страница " + (index + 1) + " из " + pages.count, 420, 787, { width: 117, align: "right", lineBreak: false });
    pdf.restore();
  }

  pdf.end();
  return completed;
}

export async function persistAnalyticalDocumentPdf({ directory, bytes }) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    throw new TypeError("An absolute private PDF storage directory is required");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error("PDF storage path must be a real directory");
  }
  // mkdir(mode) does not change permissions when the directory already exists.
  // Enforce owner-only access on every write, not only on first creation.
  await chmod(directory, 0o700);
  const key = randomUUID() + ".pdf";
  const target = path.join(directory, key);
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  return { key, target, sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.length };
}

export async function readStoredAnalyticalDocumentPdf({ directory, key, sha256, byteSize }) {
  if (!/^[0-9a-f-]{36}\.pdf$/i.test(key ?? "")) throw new Error("Invalid PDF storage key");
  const target = path.join(directory, key);
  const bytes = await readFile(target);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== sha256 || bytes.length !== byteSize) throw new Error("Stored analytical PDF integrity check failed");
  return bytes;
}

export async function removeStoredAnalyticalDocumentPdf(target) {
  if (typeof target === "string") await unlink(target).catch(() => {});
}
