jest.mock("../../utils/files", () => ({
  createdDate: jest.fn(() => "2026-11-14"),
  trashFile: jest.fn(),
  writeToServerDocuments: jest.fn(({ data }) => data),
}));
jest.mock("../../utils/tokenizer", () => ({
  tokenizeString: jest.fn(() => 10),
}));
jest.mock("../../utils/ingestion", () => {
  const actual = jest.requireActual("../../utils/ingestion");
  return {
    ...actual,
    persistReport: jest.fn((report) => ({
      ...actual.summarizeReport(report),
      ingestionReportId: "test-report-id",
    })),
  };
});
jest.mock("uuid", () => ({ v4: () => "test-id" }), { virtual: true });
jest.mock("slugify", () => ({ default: (name) => name }), { virtual: true });
jest.mock("../../processSingleFile/convert/asPDF/PDFLoader", () =>
  jest.fn().mockImplementation(() => ({ load: jest.fn() }))
);
jest.mock("../../utils/OCRLoader", () =>
  jest.fn().mockImplementation(() => ({ ocrPDF: jest.fn() }))
);

const PDFLoader = require("../../processSingleFile/convert/asPDF/PDFLoader");
const OCRLoader = require("../../utils/OCRLoader");
const { writeToServerDocuments, trashFile } = require("../../utils/files");
const asPdf = require("../../processSingleFile/convert/asPDF");
const { persistReport } = require("../../utils/ingestion");

const page = (pageNumber, pageContent) => ({
  pageContent,
  metadata: {
    pdf: { totalPages: 3, info: { Creator: "Author", Title: "Report" } },
    loc: { pageNumber },
  },
});

let load;
let ocrPDF;
beforeEach(() => {
  jest.clearAllMocks();
  load = jest.fn();
  ocrPDF = jest.fn();
  PDFLoader.mockImplementation(() => ({ load }));
  OCRLoader.mockImplementation(() => ({ ocrPDF }));
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const run = (options = {}) =>
  asPdf({ fullFilePath: "mixed.pdf", filename: "mixed.pdf", options });

test("mixed PDF OCRs only empty pages and preserves Chinese/English page order", async () => {
  load.mockResolvedValue([
    page(1, "中文原文"),
    page(2, ""),
    page(3, "English original"),
  ]);
  ocrPDF.mockResolvedValue([page(2, "扫描文字 scanned text")]);

  const result = await run({ ocr: { langList: "chi_sim,eng" } });

  expect(PDFLoader).toHaveBeenCalledWith("mixed.pdf", {
    splitPages: true,
    includeEmptyPages: true,
  });
  expect(OCRLoader).toHaveBeenCalledWith({ targetLanguages: "chi_sim,eng" });
  expect(ocrPDF).toHaveBeenCalledWith("mixed.pdf", { pageNumbers: [2] });
  expect(result.documents[0].pageContent).toBe(
    "中文原文\n\n扫描文字 scanned text\n\nEnglish original"
  );
  expect(result.documents[0]).toMatchObject({
    docAuthor: "Author",
    description: "Report",
  });
});

test("fully digital PDFs do not create an OCR worker", async () => {
  load.mockResolvedValue([page(1, "First"), page(2, "第二页")]);
  const result = await run();
  expect(result.documents[0].pageContent).toBe("First\n\n第二页");
  expect(OCRLoader).not.toHaveBeenCalled();
});

test("fully scanned PDFs retain original order even if OCR returns out of order", async () => {
  load.mockResolvedValue([page(1, ""), page(2, " \n\t"), page(3, "")]);
  ocrPDF.mockResolvedValue([
    page(3, "Third"),
    page(1, "第一"),
    page(2, "Second"),
  ]);
  const result = await run();
  expect(ocrPDF).toHaveBeenCalledWith("mixed.pdf", { pageNumbers: [1, 2, 3] });
  expect(result.documents[0].pageContent).toBe("第一\n\nSecond\n\nThird");
});

test("OCR cannot overwrite existing native text or insert unrequested pages", async () => {
  load.mockResolvedValue([page(1, "Native"), page(2, "")]);
  ocrPDF.mockResolvedValue([
    page(1, "Incorrect replacement"),
    page(2, "Recognized"),
    page(99, "Unexpected"),
  ]);
  const result = await run();
  expect(result.documents[0].pageContent).toBe("Native\n\nRecognized");
});

test("blank or unrecognized pages are skipped with a diagnostic warning", async () => {
  load.mockResolvedValue([page(1, "Native"), page(2, ""), page(3, "")]);
  ocrPDF.mockResolvedValue([page(3, " \n")]);
  const result = await run();
  expect(result.success).toBe(true);
  expect(result.documents[0].pageContent).toBe("Native");
  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining("2 page(s) still have no text after OCR")
  );
});

test("an unrecognized scan fails without writing an empty document", async () => {
  load.mockResolvedValue([page(1, "")]);
  ocrPDF.mockResolvedValue([]);
  const result = await run();
  expect(result).toMatchObject({ success: false, documents: [] });
  expect(writeToServerDocuments).not.toHaveBeenCalled();
});

test("an OCR runtime failure retains the native pages with a warning", async () => {
  load.mockResolvedValue([page(1, "Native text"), page(2, "")]);
  ocrPDF.mockRejectedValue(new Error("OCR runtime unavailable"));
  const result = await run();
  expect(result.success).toBe(true);
  expect(result.documents[0].pageContent).toBe("Native text");
  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining("keeping available native text"),
    "OCR runtime unavailable"
  );
});

test("parse-only and absolute-path options remain supported", async () => {
  load.mockResolvedValue([page(1, "Native"), page(2, "")]);
  ocrPDF.mockResolvedValue([page(2, "Recognized")]);
  await run({ parseOnly: true, absolutePath: "mixed.pdf" });
  expect(writeToServerDocuments).toHaveBeenCalledWith(
    expect.objectContaining({ options: { parseOnly: true } })
  );
  expect(trashFile).not.toHaveBeenCalled();
});

test("a PDF without pages fails without starting OCR", async () => {
  load.mockResolvedValue([]);
  expect(await run()).toMatchObject({ success: false, documents: [] });
  expect(OCRLoader).not.toHaveBeenCalled();
});

test("page spans recover exact Chinese, astral Unicode and English page text", async () => {
  load.mockResolvedValue([page(1, "中文𠀀"), page(2, ""), page(3, "English")]);
  ocrPDF.mockResolvedValue([page(2, "扫描内容")]);
  const result = await run();
  const report = persistReport.mock.calls[0][0];
  expect(report.status).toBe("complete");
  expect(report.offsetUnit).toBe("utf16-code-units");
  expect(report.pages.map((entry) => entry.method)).toEqual([
    "native",
    "ocr",
    "native",
  ]);
  expect(
    report.pages.map((entry) =>
      result.documents[0].pageContent.slice(entry.start, entry.end)
    )
  ).toEqual(["中文𠀀", "扫描内容", "English"]);
  expect(result.documents[0].ingestionReportId).toBe("test-report-id");
  expect(result.documents[0]).not.toHaveProperty("pages");
});

test("missing pages produce a persisted partial import report", async () => {
  load.mockResolvedValue([page(1, "Native"), page(2, "")]);
  ocrPDF.mockResolvedValue([
    {
      ...page(2, ""),
      metadata: {
        ...page(2, "").metadata,
        ocr: { status: "timeout", error: "Deadline exceeded" },
      },
    },
  ]);
  const result = await run();
  expect(result.documents[0].ingestionStatus).toBe("partial");
  expect(persistReport).toHaveBeenCalledWith(
    expect.objectContaining({
      pages: expect.arrayContaining([
        expect.objectContaining({
          pageNumber: 2,
          status: "timeout",
          start: null,
          end: null,
        }),
      ]),
      warnings: expect.arrayContaining([
        expect.objectContaining({
          code: "PDF_PAGES_UNRESOLVED",
          pageNumbers: [2],
        }),
      ]),
    })
  );
});

test("a PDF parser failure is returned with a failed report", async () => {
  load.mockRejectedValue(new Error("Invalid PDF"));
  expect(await run()).toMatchObject({
    success: false,
    reason: "Invalid PDF",
    ingestionStatus: "failed",
    ingestionReportId: "test-report-id",
  });
  expect(writeToServerDocuments).not.toHaveBeenCalled();
});
