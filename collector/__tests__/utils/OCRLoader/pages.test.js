jest.mock("fs", () => ({
  existsSync: jest.fn(() => true),
  statSync: jest.fn(() => ({ isFile: () => true })),
  readFileSync: jest.fn(() => Buffer.from("PDF fixture")),
}));
jest.mock("os", () => ({ cpus: () => [{}, {}] }));
jest.mock(
  "tesseract.js",
  () => ({ createWorker: jest.fn(), OEM: { LSTM_ONLY: 1 } }),
  { virtual: true }
);

const getPage = jest.fn();
const getDocument = jest.fn();
const recognize = jest.fn();
const terminate = jest.fn();
const destroy = jest.fn();
const runtimeImports = {
  "pdf-parse/lib/pdf.js/v2.0.550/build/pdf.js": {
    getDocument,
    OPS: { paintImageXObject: 1 },
  },
  sharp: {
    default: (data) => {
      const image = {
        resize: () => image,
        withMetadata: () => image,
        png: () => image,
        toBuffer: async () => data,
      };
      return image;
    },
  },
};

const { createWorker } = require("tesseract.js");
// Run the real loader with isolated PDF/OCR runtimes, without downloading models
// or installing collector dependencies. Dynamic imports use VM module stubs.
const vm = require("vm");
const path = require("path");
const fs = jest.requireActual("fs");
const { createRequire } = require("module");
const loaderPath = path.resolve(__dirname, "../../../utils/OCRLoader/index.js");
const loaderRequire = createRequire(loaderPath);
const loaderModule = { exports: {} };
new vm.Script(
  `(function(require, module, exports, __dirname, console) {\n${fs.readFileSync(loaderPath, "utf8")}\n})`,
  {
    filename: loaderPath,
    importModuleDynamically: async (specifier) => {
      const exports = runtimeImports[specifier];
      if (!exports) throw new Error(`Unexpected import: ${specifier}`);
      const module = new vm.SyntheticModule(Object.keys(exports), function () {
        for (const [name, value] of Object.entries(exports))
          this.setExport(name, value);
      });
      await module.link(() => {});
      await module.evaluate();
      return module;
    },
  }
).runInThisContext()(
  (specifier) =>
    ["fs", "os", "tesseract.js"].includes(specifier)
      ? require(specifier)
      : loaderRequire(specifier),
  loaderModule,
  loaderModule.exports,
  path.dirname(loaderPath),
  console
);
const OCRLoader = loaderModule.exports;

// The normal Jest command also works: rerun this isolated suite in a child
// process when Node has not enabled the VM module API used by the import hook.
if (typeof vm.SyntheticModule !== "function") {
  test("OCR page selection with isolated PDF and OCR runtimes", () => {
    require("child_process").execFileSync(
      process.execPath,
      [
        "--experimental-vm-modules",
        require.resolve("jest/bin/jest"),
        "--runInBand",
        "--runTestsByPath",
        __filename,
        "--silent",
      ],
      { timeout: 15000, stdio: "pipe" }
    );
  });
}

const describeRuntime =
  typeof vm.SyntheticModule === "function" ? describe : describe.skip;
describeRuntime("OCR page selection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
    getDocument.mockResolvedValue({
      numPages: 5,
      getMetadata: async () => ({}),
      getPage,
      destroy,
    });
    getPage.mockImplementation(async (pageNumber) => ({
      pageNumber,
      getOperatorList: async () => ({ fnArray: [1], argsArray: [["image"]] }),
      objs: {
        get: async () => ({
          width: 2,
          height: 2,
          data: Buffer.alloc(12, pageNumber),
        }),
      },
    }));
    recognize.mockImplementation(async (data) => ({
      data: { text: `Page ${data[0]}` },
    }));
    createWorker.mockResolvedValue({ recognize, terminate });
  });
  afterEach(() => jest.restoreAllMocks());

  test("only selected pages are recognized, deduplicated and returned in order", async () => {
    const docs = await new OCRLoader().ocrPDF("mixed.pdf", {
      pageNumbers: [5, 2, 2],
      batchSize: 1,
    });
    expect(getPage.mock.calls.map(([number]) => number)).toEqual([2, 5]);
    expect(docs.map((doc) => doc.pageContent)).toEqual(["Page 2", "Page 5"]);
    expect(docs.map((doc) => doc.metadata.loc.pageNumber)).toEqual([2, 5]);
    expect(docs.every((doc) => doc.metadata.pdf.totalPages === 5)).toBe(true);
    expect(recognize).toHaveBeenCalledTimes(2);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  test("omitting pageNumbers retains whole-document OCR", async () => {
    const docs = await new OCRLoader().ocrPDF("scan.pdf");
    expect(docs.map((doc) => doc.metadata.loc.pageNumber)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(recognize).toHaveBeenCalledTimes(5);
  });

  test("an empty selection does not initialize the parser or OCR workers", async () => {
    expect(
      await new OCRLoader().ocrPDF("mixed.pdf", { pageNumbers: [] })
    ).toEqual([]);
    expect(getDocument).not.toHaveBeenCalled();
    expect(createWorker).not.toHaveBeenCalled();
  });

  test.each([[0], [6], [1.5], ["2"]])(
    "invalid page selection %p is rejected before worker creation",
    async (pageNumber) => {
      await expect(
        new OCRLoader().ocrPDF("mixed.pdf", { pageNumbers: [pageNumber] })
      ).rejects.toThrow("existing PDF pages");
      expect(createWorker).not.toHaveBeenCalled();
      expect(destroy).toHaveBeenCalledTimes(1);
    }
  );

  test("a non-array selection is rejected", async () => {
    await expect(
      new OCRLoader().ocrPDF("mixed.pdf", { pageNumbers: "2" })
    ).rejects.toThrow("must be an array");
  });

  test("invalid execution settings still release the opened PDF", async () => {
    await expect(
      new OCRLoader().ocrPDF("mixed.pdf", { maxWorkers: 0 })
    ).rejects.toThrow("positive integer");
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(createWorker).not.toHaveBeenCalled();
  });
});
