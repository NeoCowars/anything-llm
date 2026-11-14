// Synthetic ONNX graphs exercise loading contracts, not semantic model quality.
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.STORAGE_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "anything-local-runtime-")
);
const library = require("../../../utils/LocalModelLibrary");
function importFixture(kind) {
  const source = path.join(__dirname, kind);
  const staging = fs.mkdtempSync(path.join(process.env.STORAGE_DIR, "stage-"));
  const files = fs
    .readdirSync(source, { recursive: true })
    .filter((name) => fs.statSync(path.join(source, name)).isFile());
  return library.importModel(
    { name: kind + " synthetic", kind },
    files.map((name, i) => {
      const target = path.join(staging, String(i));
      fs.copyFileSync(path.join(source, name), target);
      return {
        path: target,
        relativePath:
          kind === "reranker" && name.endsWith("model.onnx")
            ? "onnx/model_quantized.onnx"
            : name.split(path.sep).join("/"),
      };
    })
  );
}
(async () => {
  try {
    const { env } = await import("@xenova/transformers");
    env.allowRemoteModels = false;
    global.fetch = () => {
      throw new Error("Runtime test must remain offline");
    };
    const embedding = importFixture("embedding");
    const reranker = importFixture("reranker");
    const {
      NativeEmbedder,
    } = require("../../../utils/EmbeddingEngines/native");
    const engine = new NativeEmbedder(embedding.id);
    const vectors = await engine.embedChunks(["本地模型测试", "交通补贴"]);
    assert.equal(vectors.length, 2);
    assert.equal(vectors[0].length, 4);
    assert(vectors.flat().every(Number.isFinite));
    const query = await engine.embedTextInput("本地模型");
    assert.equal(query.length, 4);
    const { rerank } = require("../../../utils/EmbeddingRerankers");
    const {
      mergeSettings,
    } = require("../../../utils/EmbeddingRerankers/config");
    const settings = mergeSettings({
      RerankProvider: "local",
      RerankLocalModel: reranker.id,
      RerankTimeoutMs: 120000,
    });
    const ranking = await rerank(
      "试用期有交通补贴吗？",
      [{ text: "正式员工有交通补贴。" }, { text: "试用期员工无交通补贴。" }],
      settings
    );
    assert.equal(ranking.length, 2);
    assert(ranking.every((row) => Number.isFinite(row.score)));
    assert(library.listModels().every((model) => model.loaded));
    assert.throws(() => library.deleteModel(embedding.id), /loaded/);
    console.log("OFFLINE_LOCAL_INFERENCE_OK");
  } finally {
    fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
