const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock("../../../models/documents", () => ({
  Document: { removeDocuments: jest.fn() },
}));
jest.mock("../../../models/workspace", () => ({
  Workspace: { where: jest.fn(async () => []) },
}));

const {
  persistReport,
  createReport,
} = require("../../../../collector/utils/ingestion");
const { readIngestionReport } = require("../../../utils/ingestionReports");
let storage;
const originalStorage = process.env.STORAGE_DIR;
const originalMode = process.env.NODE_ENV;
let files;
let purgeFolder;

beforeEach(() => {
  storage = fs.mkdtempSync(path.join(os.tmpdir(), "ingestion-cleanup-"));
  process.env.STORAGE_DIR = storage;
  process.env.NODE_ENV = "test";
  jest.isolateModules(() => {
    files = require("../../../utils/files");
    ({ purgeFolder } = require("../../../utils/files/purgeDocument"));
  });
  fs.mkdirSync(path.join(files.documentsPath, "custom-documents"), {
    recursive: true,
  });
});

afterEach(() => {
  if (originalStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = originalStorage;
  process.env.NODE_ENV = originalMode;
  expect(path.dirname(storage)).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(storage, { recursive: true, force: true });
});

function writeDocument(folder) {
  const metadata = persistReport(
    createReport({ filename: "中文.pdf", format: "pdf" })
  );
  const directory = path.join(files.documentsPath, folder);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "sample.json"),
    JSON.stringify(metadata)
  );
  return metadata.ingestionReportId;
}

test("deleting a source document also removes its independent report", async () => {
  const id = writeDocument("custom-documents");
  await files.purgeSourceDocument("custom-documents/sample.json");
  expect(readIngestionReport(id)).toBeNull();
  expect(
    fs.existsSync(
      path.join(files.documentsPath, "custom-documents/sample.json")
    )
  ).toBe(false);
});

test("deleting an allowed folder cleans up its reports and preserves protected folders", async () => {
  const id = writeDocument("reports");
  await purgeFolder("reports");
  expect(readIngestionReport(id)).toBeNull();
  expect(fs.existsSync(path.join(files.documentsPath, "reports"))).toBe(false);
  expect(
    fs.existsSync(path.join(files.documentsPath, "custom-documents"))
  ).toBe(true);
});
