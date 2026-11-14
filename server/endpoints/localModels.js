const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const multer = require("multer");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const ModelLibrary = require("../utils/LocalModelLibrary");

function localModelEndpoints(app) {
  const admin = [validatedRequest, flexUserRoleValid([ROLES.admin])];
  app.get("/system/local-models", admin, (_request, response) => {
    try {
      response.json({ models: ModelLibrary.listModels() });
    } catch {
      response
        .status(500)
        .json({ error: "Could not read local model library." });
    }
  });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (request, _file, callback) =>
        callback(null, request.modelStaging),
      filename: (_request, _file, callback) => callback(null, randomUUID()),
    }),
    limits: {
      files: 128,
      fileSize: 2 * 1024 ** 3,
      fields: 10,
      fieldSize: 256 * 1024,
    },
  }).array("files", 128);

  app.post("/system/local-models/import", admin, (request, response) => {
    try {
      fs.mkdirSync(ModelLibrary.root(), { recursive: true });
      request.modelStaging = fs.mkdtempSync(
        path.join(ModelLibrary.root(), ".upload-")
      );
    } catch {
      return response
        .status(500)
        .json({ error: "Could not create model upload directory." });
    }
    const cleanup = () =>
      fs.rmSync(request.modelStaging, { recursive: true, force: true });
    upload(request, response, (error) => {
      try {
        if (error)
          throw new Error("Model upload failed or exceeds upload limits.");
        const paths = JSON.parse(request.body.paths || "[]");
        if (!Array.isArray(paths) || paths.length !== request.files?.length)
          throw new Error("Model file manifest does not match the upload.");
        const model = ModelLibrary.importModel(
          request.body,
          request.files.map((file, index) => ({
            path: file.path,
            relativePath: paths[index],
          }))
        );
        return response.status(201).json({ model });
      } catch (error) {
        return response.status(400).json({ error: error.message });
      } finally {
        cleanup();
      }
    });
  });
  app.delete("/system/local-models/:id", admin, (request, response) => {
    try {
      ModelLibrary.deleteModel(request.params.id);
      response.json({ success: true });
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });
  app.post(
    "/system/local-models/:id/test",
    admin,
    async (request, response) => {
      const start = Date.now();
      let model;
      try {
        model = ModelLibrary.getModel(request.params.id);
        let result;
        if (model.kind === "embedding") {
          const {
            NativeEmbedder,
          } = require("../utils/EmbeddingEngines/native");
          const vectors = await new NativeEmbedder(model.id).embedChunks([
            "本地模型推理测试",
          ]);
          const vector = vectors?.[0];
          if (
            !Array.isArray(vector) ||
            !vector.length ||
            !vector.every(
              (value) => typeof value === "number" && Number.isFinite(value)
            )
          )
            throw new Error("Invalid embedding output.");
          result = { dimensions: vector.length };
        } else {
          const { rerank } = require("../utils/EmbeddingRerankers");
          const {
            mergeSettings,
            DEFAULTS,
          } = require("../utils/EmbeddingRerankers/config");
          const settings = mergeSettings(
            {
              RerankProvider: "local",
              RerankLocalModel: model.id,
              RerankTimeoutMs: 120000,
            },
            { ...DEFAULTS, RerankApiKey: "" }
          );
          result = {
            ranking: await rerank(
              "试用期有交通补贴吗？",
              [
                { text: "正式员工有交通补贴。" },
                { text: "试用期员工没有交通补贴。" },
              ],
              settings
            ),
          };
        }
        ModelLibrary.recordTest(model.id, true);
        return response.json({
          success: true,
          elapsedMs: Date.now() - start,
          ...result,
        });
      } catch {
        if (model) {
          try {
            ModelLibrary.recordTest(model.id, false);
          } catch {
            /* Preserve inference error. */
          }
        }
        return response.status(422).json({
          error:
            "Local inference failed. Check that the model is compatible with Transformers.js v2 and the selected task.",
        });
      }
    }
  );
  app.post("/system/embedding-test", admin, async (request, response) => {
    try {
      const { basePath, model, apiKey } = request.body || {};
      const url = new URL(basePath);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hash ||
        typeof model !== "string" ||
        !model.trim() ||
        model.length > 500 ||
        (apiKey !== undefined && typeof apiKey !== "string")
      )
        return response
          .status(400)
          .json({ error: "Invalid embedding API settings." });
      const {
        GenericOpenAiEmbedder,
      } = require("../utils/EmbeddingEngines/genericOpenAi");
      const start = Date.now();
      const engine = new GenericOpenAiEmbedder({
        basePath,
        model,
        timeout: 30000,
        apiKey:
          apiKey === undefined || /^\*+$/.test(apiKey)
            ? process.env.GENERIC_OPEN_AI_EMBEDDING_API_KEY || ""
            : apiKey,
      });
      const vectors = await engine.embedChunks(["本地和远端模型连接测试"]);
      response.json({
        dimensions: vectors[0].length,
        elapsedMs: Date.now() - start,
      });
    } catch {
      response.status(422).json({
        error:
          "Embedding connection failed. Check URL, model, credentials and response format.",
      });
    }
  });
}
module.exports = { localModelEndpoints };
