const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const library = require("../../utils/LocalModelLibrary");
const originalEnv = { ...process.env };
let directory;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "anything-local-test-"));
  process.env.STORAGE_DIR = directory;
  delete process.env.EMBEDDING_MODEL_PREF;
  delete process.env.RERANK_LOCAL_MODEL;
});
afterEach(() => {
  process.env = { ...originalEnv };
  fs.rmSync(directory, { recursive: true, force: true });
});
function files(kind = "embedding") {
  const source = path.resolve(__dirname, "../fixtures/local-models", kind);
  return fs
    .readdirSync(source, { recursive: true })
    .filter((name) => fs.statSync(path.join(source, name)).isFile())
    .map((name, index) => {
      const target = path.join(directory, "upload-" + index);
      fs.copyFileSync(path.join(source, name), target);
      return { path: target, relativePath: name.split(path.sep).join("/") };
    });
}
test("imports immutable models, persists metadata, exposes no server path and deletes files", () => {
  const imported = library.importModel(
    {
      kind: "embedding",
      name: " E5 中文 ",
      queryPrefix: "query: ",
      chunkPrefix: "passage: ",
    },
    files()
  );
  expect(imported.name).toBe("E5 中文");
  expect(imported.status).toBe("files-validated");
  expect(imported.queryPrefix).toBe("query: ");
  expect(library.listModels()[0]).not.toHaveProperty("modelPath");
  const location = library.getModel(imported.id, "embedding").modelPath;
  expect(fs.existsSync(path.join(location, "onnx/model.onnx"))).toBe(true);
  expect(() => library.getModel(imported.id, "reranker")).toThrow();
  library.recordTest(imported.id, true);
  expect(library.listModels()[0].status).toBe("inference-tested");
  library.deleteModel(imported.id);
  expect(library.listModels()).toEqual([]);
  expect(fs.existsSync(location)).toBe(false);
});
test.each([
  "../config.json",
  "onnx/../../x.onnx",
  "C:/x.onnx",
  "a\\b.onnx",
  "/x.json",
  "CON.json",
  "a./x.json",
  "a//x.json",
  "code.py",
  "weights.safetensors",
])("rejects invalid paths %s", (name) => {
  expect(() => library.safeRelativePath(name)).toThrow();
});
test("rejects case mismatches, duplicates, malformed JSON and incompatible reranker heads without registering a model", () => {
  let batch = files();
  batch.find((file) => file.relativePath.endsWith(".onnx")).relativePath =
    "ONNX/MODEL.ONNX";
  expect(() =>
    library.importModel({ kind: "embedding", name: "bad" }, batch)
  ).toThrow(/Missing onnx/);
  batch = files();
  expect(() =>
    library.importModel({ kind: "embedding", name: "bad" }, [
      ...batch,
      { ...batch[0], relativePath: batch[0].relativePath.toUpperCase() },
    ])
  ).toThrow(/Duplicate/);
  batch = files();
  fs.writeFileSync(
    batch.find((file) => file.relativePath === "config.json").path,
    "{"
  );
  expect(() =>
    library.importModel({ kind: "embedding", name: "bad" }, batch)
  ).toThrow(/Invalid config/);
  expect(() =>
    library.importModel({ kind: "reranker", name: "wrong task" }, files())
  ).toThrow(/sequence classification/);
  batch = files("reranker");
  const config = batch.find((file) => file.relativePath === "config.json");
  fs.writeFileSync(
    config.path,
    JSON.stringify({ architectures: {}, num_labels: 1 })
  );
  expect(() =>
    library.importModel({ kind: "reranker", name: "bad config" }, batch)
  ).toThrow(/sequence classification/);
  expect(library.listModels()).toEqual([]);
});
test("prevents deleting selected, in-use or loaded models", () => {
  const model = library.importModel(
    { kind: "reranker", name: "reranker" },
    files("reranker")
  );
  process.env.RERANK_PROVIDER = "local";
  process.env.RERANK_LOCAL_MODEL = model.id;
  expect(() => library.deleteModel(model.id)).toThrow(/Switch away/);
  process.env.RERANK_PROVIDER = "tei";
  const release = library.acquire(model.id);
  expect(() => library.deleteModel(model.id)).toThrow(/loaded/);
  release();
  library.markLoaded(model.id);
  expect(() => library.deleteModel(model.id)).toThrow(/loaded/);
});
test("actual Transformers.js inference runs imported embedding and reranker ONNX models offline", async () => {
  const result = await promisify(execFile)(
    process.execPath,
    [path.resolve(__dirname, "../fixtures/local-models/runtime.cjs")],
    { timeout: 120000 }
  );
  expect(result.stdout).toContain("OFFLINE_LOCAL_INFERENCE_OK");
}, 130000);
