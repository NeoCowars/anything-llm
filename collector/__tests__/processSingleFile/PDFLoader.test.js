jest.mock("fs", () => ({
  promises: { readFile: jest.fn(async () => Buffer.from("PDF fixture")) },
}));

const PDFLoader = require("../../processSingleFile/convert/asPDF/PDFLoader");

const text = (str) => ({ str, transform: [1, 0, 0, 1, 10, 20] });
const pageItems = [[text("中文 English")], [], [text(" \t\n ")]];

function loader(options, items = pageItems) {
  const instance = new PDFLoader("test.pdf", options);
  instance.destroyPDF = jest.fn();
  instance.getPdfJS = jest.fn(async () => ({
    version: "test",
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: items.length,
        destroy: instance.destroyPDF,
        getMetadata: async () => ({ info: { Title: "Mixed document" } }),
        getPage: async (number) => ({
          getTextContent: async () => {
            if (items[number - 1] instanceof Error) throw items[number - 1];
            return { items: items[number - 1] };
          },
        }),
      }),
    }),
  }));
  return instance;
}

test("page-aware loading preserves empty and whitespace-only page positions", async () => {
  const docs = await loader({ includeEmptyPages: true }).load();
  expect(docs.map((doc) => doc.pageContent)).toEqual(["中文 English", "", ""]);
  expect(docs.map((doc) => doc.metadata.loc.pageNumber)).toEqual([1, 2, 3]);
  expect(docs.every((doc) => doc.metadata.pdf.totalPages === 3)).toBe(true);
});

test("default loading returns only non-empty text pages", async () => {
  const docs = await loader().load();
  expect(docs).toHaveLength(1);
  expect(docs[0].pageContent).toBe("中文 English");
});

test("combined loading retains the existing document shape", async () => {
  const docs = await loader({ splitPages: false }).load();
  expect(docs).toHaveLength(1);
  expect(docs[0]).toMatchObject({
    pageContent: "中文 English",
    metadata: { source: "test.pdf", pdf: { totalPages: 3 } },
  });
});

test("a failed page is retained for OCR and later pages are still extracted", async () => {
  const docs = await loader({ includeEmptyPages: true }, [
    [text("First")],
    new Error("Broken text layer"),
    [text("第三页")],
  ]).load();
  expect(docs.map((doc) => doc.pageContent)).toEqual(["First", "", "第三页"]);
  expect(docs[1].metadata).toMatchObject({
    loc: { pageNumber: 2 },
    extractionError: "Broken text layer",
  });
});

test("the default loader continues to reject failed pages", async () => {
  const instance = loader({}, [new Error("Broken text layer")]);
  await expect(instance.load()).rejects.toThrow("Broken text layer");
  expect(instance.destroyPDF).toHaveBeenCalledTimes(1);
});

test("the native PDF is released after successful extraction", async () => {
  const instance = loader();
  await instance.load();
  expect(instance.destroyPDF).toHaveBeenCalledTimes(1);
});
