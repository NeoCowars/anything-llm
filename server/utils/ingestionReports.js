const fs = require("fs");
const path = require("path");

function reportPath(id) {
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) return null;
  const storage =
    process.env.NODE_ENV === "development" || !process.env.STORAGE_DIR
      ? path.resolve(__dirname, "../storage")
      : path.resolve(process.env.STORAGE_DIR);
  return path.join(storage, "ingestion-reports", `${id}.json`);
}

function readIngestionReport(id) {
  const filename = reportPath(id);
  if (!filename || !fs.existsSync(filename)) return null;
  return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function removeIngestionReport(id) {
  const filename = reportPath(id);
  if (filename) fs.rmSync(filename, { force: true });
}

function uploadWarnings(documents = []) {
  return documents
    .filter((document) => document.ingestionWarning)
    .map((document) => `${document.title}: ${document.ingestionWarning}`);
}

module.exports = { readIngestionReport, removeIngestionReport, uploadWarnings };
