const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const loaded = new Set();
const users = new Map();
const ID_PATTERN = /^local-[a-f0-9-]{36}$/;

function root() {
  return path.resolve(
    process.env.STORAGE_DIR || path.resolve(__dirname, "../../storage"),
    "models/library"
  );
}
function readRegistry() {
  const file = path.join(root(), "registry.json");
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data)) throw new Error("Invalid local model registry.");
  return data;
}
function writeRegistry(models) {
  fs.mkdirSync(root(), { recursive: true });
  const file = path.join(root(), "registry.json");
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(models, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function selected(id) {
  return (
    ((process.env.EMBEDDING_ENGINE || "native") === "native" &&
      process.env.EMBEDDING_MODEL_PREF === id) ||
    (process.env.RERANK_PROVIDER === "local" &&
      process.env.RERANK_LOCAL_MODEL === id)
  );
}
function listModels() {
  return readRegistry().map((model) => ({
    ...model,
    selected: selected(model.id),
    loaded: loaded.has(model.id) || !!users.get(model.id),
  }));
}
function getModel(id, kind = null) {
  if (!ID_PATTERN.test(id)) throw new Error("Invalid local model ID.");
  const model = readRegistry().find((entry) => entry.id === id);
  if (!model || (kind && model.kind !== kind))
    throw new Error("Local model not found or model task does not match.");
  const modelPath = path.join(root(), id);
  if (!fs.existsSync(path.join(modelPath, "config.json")))
    throw new Error("Local model files are missing.");
  return { ...model, modelPath };
}
function acquire(id) {
  getModel(id);
  users.set(id, (users.get(id) || 0) + 1);
  return () => users.set(id, Math.max(0, (users.get(id) || 1) - 1));
}
function markLoaded(id) {
  loaded.add(id);
}
function safeRelativePath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 240 ||
    /[\\:*?"<>|]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    value.startsWith("/") ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part === "." ||
          part === ".." ||
          /[. ]$/.test(part) ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part)
      )
  )
    throw new Error("Invalid model file path.");
  // Model files are data. Python/JavaScript code and executable files are not imported.
  if (!/\.(json|txt|model|onnx|onnx_data|data)$/i.test(value))
    throw new Error(
      "Only ONNX weights and tokenizer/configuration files are supported."
    );
  return value;
}
function jsonFile(files, name) {
  const file = files.find((entry) => entry.relativePath === name);
  // Multilingual tokenizers can be much larger than their model configuration.
  if (
    !file ||
    fs.statSync(file.path).size >
      (name === "tokenizer.json" ? 128 : 10) * 1024 * 1024
  )
    throw new Error("Missing or oversized " + name + ".");
  try {
    const data = JSON.parse(fs.readFileSync(file.path, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    return data;
  } catch {
    throw new Error("Invalid " + name + ".");
  }
}
function validateOptions(input) {
  const { kind, name } = input;
  if (!["embedding", "reranker"].includes(kind))
    throw new Error("Choose embedding or reranker.");
  if (typeof name !== "string" || !name.trim() || name.length > 100)
    throw new Error("Model name must contain 1–100 characters.");
  const options = {
    kind,
    name: name.trim(),
    pooling: input.pooling || "mean",
    normalize: input.normalize !== false && input.normalize !== "false",
    chunkPrefix: input.chunkPrefix || "",
    queryPrefix: input.queryPrefix || "",
    maxChunkLength: Number(input.maxChunkLength ?? 1000),
  };
  if (
    !["mean", "cls"].includes(options.pooling) ||
    !Number.isInteger(options.maxChunkLength) ||
    options.maxChunkLength < 1 ||
    options.maxChunkLength > 100000
  )
    throw new Error("Invalid pooling or maximum chunk length.");
  for (const value of [options.chunkPrefix, options.queryPrefix])
    if (typeof value !== "string" || value.length > 2000)
      throw new Error("Prefixes must be text with at most 2000 characters.");
  return options;
}

// Paths refer only to files staged by our upload handler, never client-supplied
// paths on the server. Each import creates an immutable ID and directory.
function importModel(input, uploadedFiles) {
  const options = validateOptions(input);
  if (
    !Array.isArray(uploadedFiles) ||
    !uploadedFiles.length ||
    uploadedFiles.length > 128
  )
    throw new Error("Upload a model folder containing at most 128 files.");
  const seen = new Set();
  const files = uploadedFiles.map((file) => {
    const relativePath = safeRelativePath(file.relativePath);
    const folded = relativePath.toLowerCase();
    if (seen.has(folded)) throw new Error("Duplicate model file path.");
    seen.add(folded);
    const stat = fs.lstatSync(file.path);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size)
      throw new Error("Model files must be non-empty regular files.");
    return { ...file, relativePath, size: stat.size };
  });
  const config = jsonFile(files, "config.json");
  jsonFile(files, "tokenizer.json");
  jsonFile(files, "tokenizer_config.json");
  const exactPaths = new Set(files.map((file) => file.relativePath));
  const quantized = exactPaths.has("onnx/model_quantized.onnx");
  if (!quantized && !exactPaths.has("onnx/model.onnx"))
    throw new Error("Missing onnx/model.onnx or onnx/model_quantized.onnx.");
  if (
    options.kind === "reranker" &&
    (!Array.isArray(config.architectures) ||
      !config.architectures.some(
        (name) =>
          typeof name === "string" && name.endsWith("ForSequenceClassification")
      ) ||
      (config.num_labels ?? Object.keys(config.id2label || {}).length) !== 1)
  )
    throw new Error(
      "A reranker must be a sequence classification model with one score output."
    );
  const sizeBytes = files.reduce((total, file) => total + file.size, 0);
  if (sizeBytes > 8 * 1024 ** 3) throw new Error("Model folder exceeds 8 GB.");
  const id = "local-" + randomUUID();
  const directory = path.join(root(), id);
  const model = {
    id,
    ...options,
    quantized,
    sizeBytes,
    importedAt: new Date().toISOString(),
    status: "files-validated",
    files: files.map(({ relativePath, size }) => ({
      name: relativePath,
      size,
    })),
  };
  fs.mkdirSync(directory, { recursive: true });
  try {
    for (const file of files) {
      const target = path.join(directory, file.relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(file.path, target);
    }
    writeRegistry([...readRegistry(), model]);
    return model;
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
function deleteModel(id) {
  getModel(id);
  if (selected(id))
    throw new Error("Switch away from this model before deleting it.");
  if (loaded.has(id) || users.get(id))
    throw new Error(
      "This model is loaded. Restart AnythingLLM after switching models before deleting it."
    );
  const models = readRegistry();
  const directory = path.join(root(), id);
  const trash = path.join(root(), ".deleted-" + id);
  fs.renameSync(directory, trash);
  try {
    writeRegistry(models.filter((model) => model.id !== id));
  } catch (error) {
    fs.renameSync(trash, directory);
    throw error;
  }
  fs.rmSync(trash, { recursive: true, force: true });
}
function recordTest(id, success) {
  writeRegistry(
    readRegistry().map((model) =>
      model.id === id
        ? {
            ...model,
            status: success ? "inference-tested" : "test-failed",
            testedAt: new Date().toISOString(),
          }
        : model
    )
  );
}

module.exports = {
  root,
  listModels,
  getModel,
  importModel,
  deleteModel,
  acquire,
  markLoaded,
  recordTest,
  safeRelativePath,
};
