const fs = require("fs");
const os = require("os");
const path = require("path");
const { createReport, persistReport } = require("../../utils/ingestion");
const {
  readIngestionReport,
  removeIngestionReport,
  uploadWarnings,
} = require("../../../server/utils/ingestionReports");

let storage;
const originalStorage = process.env.STORAGE_DIR;
beforeEach(() => {
  storage = fs.mkdtempSync(
    path.join(os.tmpdir(), "anythingllm-ingestion-test-")
  );
  process.env.STORAGE_DIR = storage;
});
afterEach(() => {
  if (originalStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = originalStorage;
  expect(path.dirname(storage)).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(storage, { recursive: true, force: true });
});

test("page reports are stored separately and read by the server", () => {
  const report = createReport({
    format: "pdf",
    filename: "中文.pdf",
    pages: [
      { pageNumber: 1, status: "text", start: 0, end: 3 },
      { pageNumber: 2, status: "timeout", start: null, end: null },
    ],
    warnings: [{ code: "PDF_PAGES_UNRESOLVED", message: "Check page 2." }],
  });
  const metadata = persistReport(report);
  expect(metadata).toMatchObject({
    ingestionStatus: "partial",
    ingestionWarning: "Check page 2.",
    ingestionReportId: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(metadata).not.toHaveProperty("pages");
  expect(readIngestionReport(metadata.ingestionReportId)).toEqual(report);
  expect(fs.readdirSync(storage)).toEqual(["ingestion-reports"]);
  removeIngestionReport(metadata.ingestionReportId);
  expect(readIngestionReport(metadata.ingestionReportId)).toBeNull();
});

test.each([null, "../secret", "a".repeat(64) + "/other", "A".repeat(64)])(
  "invalid report id %p cannot address arbitrary files",
  (id) => {
    expect(readIngestionReport(id)).toBeNull();
    expect(() => removeIngestionReport(id)).not.toThrow();
  }
);

test("all unresolved pages are failed, all text pages are complete", () => {
  expect(
    createReport({ format: "pdf", pages: [{ status: "failed" }] }).status
  ).toBe("failed");
  expect(
    createReport({ format: "pdf", pages: [{ status: "text" }] }).status
  ).toBe("complete");
});

test("upload warnings contain titles and omit full page reports", () => {
  expect(
    uploadWarnings([
      { title: "A", ingestionWarning: "Check page 2." },
      { title: "B", ingestionWarning: "" },
    ])
  ).toEqual(["A: Check page 2."]);
});
