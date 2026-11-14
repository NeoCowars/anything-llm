const { processPages } = require("../../../utils/OCRLoader/processPages");

let options;
let recognize;
let terminate;
beforeEach(() => {
  recognize = jest.fn(async (bytes) => ({
    data: { text: `Page ${bytes[0]}` },
  }));
  terminate = jest.fn(async () => {});
  options = {
    pdfDocument: {
      getPage: jest.fn(async (pageNumber) => ({ pageNumber })),
      destroy: jest.fn(async () => {}),
    },
    pdfSharp: {
      init: jest.fn(async () => {}),
      pageToBuffer: jest.fn(async ({ page }) => Buffer.from([page.pageNumber])),
    },
    metadata: { pdf: { totalPages: 3 } },
    targetPages: [1, 2, 3],
    createWorker: jest.fn(async () => ({ recognize, terminate })),
    maxWorkers: 1,
    batchSize: 10,
    maxExecutionTime: 500,
  };
});
afterEach(() => jest.useRealTimers());

test("one page error does not discard other pages in the same batch", async () => {
  options.pdfDocument.getPage.mockImplementation(async (pageNumber) => {
    if (pageNumber === 2) throw new Error("Damaged page");
    return { pageNumber };
  });
  const docs = await processPages(options);
  expect(docs.map((doc) => doc.metadata.ocr.status)).toEqual([
    "recognized",
    "failed",
    "recognized",
  ]);
  expect(docs.map((doc) => doc.pageContent)).toEqual(["Page 1", "", "Page 3"]);
  expect(docs[1].metadata.ocr.error).toBe("Damaged page");
  expect(terminate).toHaveBeenCalledTimes(1);
  expect(options.pdfDocument.destroy).toHaveBeenCalledTimes(1);
});

test("missing images and empty OCR output receive distinct diagnostics", async () => {
  options.pdfSharp.pageToBuffer.mockImplementation(async ({ page }) =>
    page.pageNumber === 2 ? null : Buffer.from([page.pageNumber])
  );
  recognize.mockImplementation(async (bytes) => ({
    data: { text: bytes[0] === 3 ? " \n" : "Text" },
  }));
  const docs = await processPages(options);
  expect(docs.map((doc) => doc.metadata.ocr.status)).toEqual([
    "recognized",
    "no_image",
    "no_text",
  ]);
});

test("deadline keeps completed pages and freezes results against late OCR completion", async () => {
  jest.useFakeTimers();
  let finishLate;
  recognize.mockImplementation(async (bytes) =>
    bytes[0] === 1
      ? { data: { text: "Completed" } }
      : new Promise((resolve) => {
          finishLate = resolve;
        })
  );
  const pending = processPages({ ...options, maxExecutionTime: 25 });
  await jest.advanceTimersByTimeAsync(25);
  const docs = await pending;
  expect(docs.map((doc) => doc.metadata.ocr.status)).toEqual([
    "recognized",
    "timeout",
    "timeout",
  ]);
  expect(docs[0].pageContent).toBe("Completed");
  expect(terminate).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  finishLate({ data: { text: "Too late" } });
  await Promise.resolve();
  await Promise.resolve();
  expect(docs[1].pageContent).toBe("");
  expect(options.pdfDocument.getPage).toHaveBeenCalledTimes(2);
});

test("worker initialization failure cleans up workers that resolve later", async () => {
  let finishLate;
  options.createWorker
    .mockRejectedValueOnce(new Error("Model load failed"))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLate = resolve;
        })
    );
  const docs = await processPages({ ...options, maxWorkers: 2 });
  expect(docs.every((doc) => doc.metadata.ocr.status === "failed")).toBe(true);
  finishLate({ recognize, terminate });
  await Promise.resolve();
  await Promise.resolve();
  expect(terminate).toHaveBeenCalledTimes(1);
  expect(options.pdfDocument.destroy).toHaveBeenCalledTimes(1);
});

test("successful jobs clear the deadline timer", async () => {
  jest.useFakeTimers();
  const docs = await processPages(options);
  expect(docs).toHaveLength(3);
  expect(jest.getTimerCount()).toBe(0);
});

test.each(["maxWorkers", "batchSize", "maxExecutionTime"])(
  "invalid %s is rejected",
  async (key) => {
    await expect(processPages({ ...options, [key]: 0 })).rejects.toThrow(
      "positive integer"
    );
  }
);
