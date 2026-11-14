const fs = require("fs");
const path = require("path");
const { createHash } = require("crypto");

function createReport({
  format,
  filename,
  pages = [],
  warnings = [],
  ...details
}) {
  const textPages = pages.filter((page) => page.status === "text").length;
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    format,
    filename,
    status: pages.length
      ? textPages === pages.length
        ? "complete"
        : textPages > 0
          ? "partial"
          : "failed"
      : "complete",
    totalPages: pages.length,
    textPages,
    pages,
    warnings,
    ...details,
  };
}

function summarizeReport(report) {
  return {
    ingestionStatus: report.status,
    ingestionWarning: report.warnings
      .map((warning) => warning.message)
      .join(" ")
      .slice(0, 2000),
    ...(report.encoding ? { sourceEncoding: report.encoding } : {}),
  };
}

// Store page diagnostics once, outside the document library and vector metadata.
function persistReport(report) {
  const serialized = JSON.stringify(report, null, 2);
  const id = createHash("sha256").update(serialized).digest("hex");
  const storage =
    process.env.NODE_ENV === "development" || !process.env.STORAGE_DIR
      ? path.resolve(__dirname, "../../../server/storage")
      : path.resolve(process.env.STORAGE_DIR);
  const directory = path.join(storage, "ingestion-reports");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${id}.json`), serialized, "utf8");
  return { ...summarizeReport(report), ingestionReportId: id };
}

module.exports = { createReport, summarizeReport, persistReport };
