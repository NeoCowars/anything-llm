jest.mock("fs", () => ({ readFileSync: jest.fn() }));
jest.mock("../../utils/files", () => ({
  createdDate: () => "2026-11-14",
  trashFile: jest.fn(),
  writeToServerDocuments: jest.fn(({ data }) => data),
}));
jest.mock("../../utils/tokenizer", () => ({ tokenizeString: () => 10 }));
jest.mock("../../processLink/helpers/htmlToMarkdown", () => ({
  documentHtmlToMarkdown: jest.fn(
    () => "# 中文标题\n\n| 项目 | 金额 |\n| --- | --- |\n| A | 100 |"
  ),
}));
jest.mock("uuid", () => ({ v4: () => "test-id" }), { virtual: true });
jest.mock("slugify", () => ({ default: (name) => name }), { virtual: true });
jest.mock("../../utils/ingestion", () => {
  const actual = jest.requireActual("../../utils/ingestion");
  return {
    ...actual,
    persistReport: jest.fn((report) => ({
      ...actual.summarizeReport(report),
      ingestionReportId: "report-id",
    })),
  };
});
const fs = require("fs");
const { writeToServerDocuments, trashFile } = require("../../utils/files");
const { persistReport } = require("../../utils/ingestion");
const asTxt = require("../../processSingleFile/convert/asTxt");

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
const run = (metadata = {}, options = {}) =>
  asTxt({ filename: "中文.csv", fullFilePath: "中文.csv", metadata, options });

test("GBK reaches the written document as Chinese with encoding and report metadata", async () => {
  fs.readFileSync.mockReturnValue(Buffer.from("d6d0cec4", "hex"));
  const result = await run();
  expect(result.documents[0]).toMatchObject({
    pageContent: "中文",
    sourceEncoding: "gb18030",
    ingestionStatus: "complete",
    ingestionWarning: expect.stringContaining("inferred"),
    ingestionReportId: "report-id",
    documentFormat: "csv",
  });
});

test("local HTML passes through structural conversion after strict decoding", async () => {
  fs.readFileSync.mockReturnValue(Buffer.from("<h1>中文标题</h1>"));
  const result = await asTxt({
    filename: "report.html",
    fullFilePath: "report.html",
  });
  expect(result.documents[0]).toMatchObject({
    documentFormat: "markdown",
    sourceEncoding: "utf-8",
    pageContent: expect.stringContaining("# 中文标题"),
  });
});

test("metadata can explicitly select a legacy encoding", async () => {
  fs.readFileSync.mockReturnValue(Buffer.from([0xe9, 0xe9]));
  const result = await run({ textEncoding: "windows-1252" });
  expect(result.documents[0]).toMatchObject({
    pageContent: "éé",
    sourceEncoding: "windows-1252",
    ingestionWarning: "",
  });
});

test("internal parse options can override metadata without affecting parse-only", async () => {
  fs.readFileSync.mockReturnValue(Buffer.from("d6d0cec4", "hex"));
  const result = await run(
    { textEncoding: "utf-8" },
    { textEncoding: "gbk", parseOnly: true, absolutePath: "中文.csv" }
  );
  expect(result.documents[0].pageContent).toBe("中文");
  expect(writeToServerDocuments).toHaveBeenCalledWith(
    expect.objectContaining({ options: { parseOnly: true } })
  );
  expect(trashFile).not.toHaveBeenCalled();
});

test("an invalid explicit encoding returns a failed report instead of mojibake", async () => {
  fs.readFileSync.mockReturnValue(Buffer.from([0xff]));
  const result = await run({ textEncoding: "utf-8" });
  expect(result).toMatchObject({
    success: false,
    documents: [],
    ingestionStatus: "failed",
    ingestionReportId: "report-id",
  });
  expect(writeToServerDocuments).not.toHaveBeenCalled();
});

test.each(["", " \t\n"])(
  "empty source %p produces a failed report",
  async (text) => {
    fs.readFileSync.mockReturnValue(Buffer.from(text));
    expect(await run()).toMatchObject({
      success: false,
      ingestionStatus: "failed",
    });
    expect(persistReport).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" })
    );
    expect(writeToServerDocuments).not.toHaveBeenCalled();
  }
);
