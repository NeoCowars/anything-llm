jest.mock("../../utils/files", () => ({
  createdDate: () => "2026-11-15",
  trashFile: jest.fn(),
  writeToServerDocuments: jest.fn(({ data }) => data),
}));
jest.mock("../../utils/tokenizer", () => ({
  tokenizeString: (text) => text.length,
}));
jest.mock("uuid", () => ({ v4: () => "test-id" }), { virtual: true });
jest.mock("slugify", () => ({ default: (name) => name }), { virtual: true });
jest.mock("../../utils/ingestion", () => {
  const actual = jest.requireActual("../../utils/ingestion");
  return {
    ...actual,
    persistReport: jest.fn((report) => ({
      ...actual.summarizeReport(report),
      ingestionReportId: "test-report",
    })),
  };
});
const fs = require("fs");
const os = require("os");
const path = require("path");
const mammoth = require("mammoth");
const {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
} = require("../../../server/node_modules/docx");
const asDocx = require("../../processSingleFile/convert/asDocx");
const { TextSplitter } = require("../../../server/utils/TextSplitter");
const { persistReport } = require("../../utils/ingestion");
const { trashFile, writeToServerDocuments } = require("../../utils/files");
let directory;
let file;
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "structure-docx-"));
  file = path.join(directory, "费用制度.docx");
  const cell = (text) => new TableCell({ children: [new Paragraph(text)] });
  const document = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: "第一章 交通补贴",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph("第一条 正式员工享受补贴。"),
          new Paragraph("第二条 试用期员工不享受补贴。"),
          new Table({
            rows: [
              new TableRow({ children: [cell("员工类型"), cell("每月金额")] }),
              ...Array.from(
                { length: 20 },
                (_, i) =>
                  new TableRow({
                    children: [cell(`岗位${i}`), cell(`${i + 100}元`)],
                  })
              ),
            ],
          }),
          new Paragraph({
            text: "Chapter II Exceptions",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph("Article 3 Approval is required."),
        ],
      },
    ],
  });
  fs.writeFileSync(file, await Packer.toBuffer(document));
});
afterAll(() => {
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true });
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
const run = (options = {}) =>
  asDocx({
    fullFilePath: file,
    filename: "费用制度.docx",
    options: { absolutePath: file, ...options },
  });

test("a real DOCX reaches structure-aware chunks with headings, clauses and table columns", async () => {
  const result = await run();
  expect(result.success).toBe(true);
  const document = result.documents[0];
  expect(document).toMatchObject({
    documentFormat: "markdown",
    structureParser: "mammoth-markdown-v1",
    ingestionStatus: "complete",
  });
  expect(document.pageContent).toContain("# 第一章 交通补贴");
  expect(document.pageContent).toContain("| 员工类型 | 每月金额 |");
  expect(document.pageContent).toContain("Article 3 Approval is required.");
  const chunks = await new TextSplitter({
    chunkSize: 180,
    chunkOverlap: 10,
    documentFormat: document.documentFormat,
  }).splitText(document.pageContent);
  const tableChunks = chunks.filter((chunk) => /岗位\d/.test(chunk));
  expect(tableChunks.length).toBeGreaterThan(1);
  expect(
    tableChunks.every(
      (chunk) =>
        chunk.includes("员工类型") &&
        chunk.includes("每月金额") &&
        chunk.length <= 180
    )
  ).toBe(true);
  for (let i = 0; i < 20; i++)
    expect(tableChunks.join("\n")).toContain(`| 岗位${i} | ${i + 100}元 |`);
  expect(trashFile).not.toHaveBeenCalled();
});

test("parse-only still writes through the direct-upload path", async () => {
  await run({ parseOnly: true });
  expect(writeToServerDocuments).toHaveBeenCalledWith(
    expect.objectContaining({ options: { parseOnly: true } })
  );
});

test("Mammoth warnings, merged cells and embedded images reach the import report", async () => {
  jest
    .spyOn(mammoth, "convertToHtml")
    .mockImplementation(async (_file, options) => {
      const image = options.convertImage;
      expect(typeof image).toBe("function");
      // imgElement returns a conversion promise, including a deferred element.
      await image({ altText: "扫描说明" });
      return {
        value:
          '<h1>中文标题</h1><p>正文</p><img alt="扫描说明" src=""/><table><tr><td colspan="2">项目</td></tr><tr><td>A</td><td>1</td></tr></table>',
        messages: [{ message: "Unrecognized style: Custom" }],
      };
    });
  const result = await run();
  expect(result.ingestionWarning).toContain("not OCRed");
  expect(result.ingestionStatus).toBe("partial");
  expect(result.ingestionWarning).toContain("merged cells");
  expect(result.documents[0].pageContent).toContain("扫描说明");
  expect(persistReport).toHaveBeenCalledWith(
    expect.objectContaining({
      warnings: expect.arrayContaining([
        expect.objectContaining({ code: "DOCX_CONVERSION_WARNING" }),
        expect.objectContaining({ code: "DOCX_IMAGES_NOT_OCR" }),
        expect.objectContaining({ code: "DOCX_MERGED_TABLE" }),
      ]),
    })
  );
});

test("localized Chinese heading styles are recognized in a real DOCX", async () => {
  const localized = path.join(directory, "localized.docx");
  const document = new Document({
    styles: {
      paragraphStyles: [
        {
          id: "ChineseHeading",
          name: "标题 1",
          basedOn: "Normal",
          next: "Normal",
        },
      ],
    },
    sections: [
      {
        children: [
          new Paragraph({ text: "费用规定", style: "ChineseHeading" }),
          new Paragraph("第一条 保留原文。"),
        ],
      },
    ],
  });
  fs.writeFileSync(localized, await Packer.toBuffer(document));
  const result = await asDocx({
    fullFilePath: localized,
    filename: "localized.docx",
    options: { absolutePath: localized },
  });
  expect(result.documents[0].pageContent).toContain("# 费用规定");
});

test("an image-only DOCX fails clearly instead of embedding only placeholders", async () => {
  jest
    .spyOn(mammoth, "convertToHtml")
    .mockImplementation(async (_file, options) => {
      await options.convertImage({ altText: "扫描页" });
      return { value: '<p><img alt="扫描页" src=""/></p>', messages: [] };
    });
  expect(await run()).toMatchObject({
    success: false,
    ingestionStatus: "failed",
    reason: expect.stringContaining("OCR is required"),
  });
  expect(writeToServerDocuments).not.toHaveBeenCalled();
});

test("DOCX parse failures return durable diagnostic metadata", async () => {
  jest
    .spyOn(mammoth, "convertToHtml")
    .mockRejectedValue(new Error("Damaged DOCX"));
  expect(await run()).toMatchObject({
    success: false,
    ingestionStatus: "failed",
    ingestionReportId: "test-report",
  });
  expect(writeToServerDocuments).not.toHaveBeenCalled();
});
