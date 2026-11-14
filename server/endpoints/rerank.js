const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { reqBody } = require("../utils/http");
const {
  mergeSettings,
  safeSettings,
  persistDevelopmentSettings,
} = require("../utils/EmbeddingRerankers/config");
const { rerank } = require("../utils/EmbeddingRerankers");
const { updateENV } = require("../utils/helpers/updateENV");

function rerankEndpoints(app) {
  const middleware = [validatedRequest, flexUserRoleValid([ROLES.admin])];
  app.get("/system/rerank-settings", middleware, (_request, response) => {
    response.status(200).json({ settings: safeSettings() });
  });
  app.post("/system/rerank-settings", middleware, async (request, response) => {
    try {
      const settings = mergeSettings(reqBody(request));
      persistDevelopmentSettings(settings);
      const { error } = await updateENV(
        settings,
        false,
        response.locals?.user?.id
      );
      if (error) return response.status(400).json({ error });
      return response.status(200).json({ settings: safeSettings(settings) });
    } catch (error) {
      return response.status(400).json({ error: error.message });
    }
  });
  app.post("/system/rerank-test", middleware, async (request, response) => {
    let settings;
    try {
      settings = mergeSettings(reqBody(request));
    } catch (error) {
      return response.status(400).json({ error: error.message });
    }
    // Test only fixed samples. Never send workspace documents from this endpoint.
    const query = "试用期员工可以领取交通补贴吗？";
    const documents = [
      { text: "正式员工每月享受交通补贴300元。" },
      { text: "试用期员工不享受交通补贴，转正后按规定发放。" },
      { text: "会议室预约需要提前一天提交申请。" },
    ];
    const start = Date.now();
    try {
      const ranking = await rerank(query, documents, settings);
      return response.status(200).json({
        query,
        elapsedMs: Date.now() - start,
        results: ranking.map((row) => ({
          ...row,
          text: documents[row.index].text,
        })),
      });
    } catch {
      // Remote error messages can contain credentials or request bodies.
      return response.status(502).json({
        error:
          "Rerank test failed. Check the endpoint, model, authentication and timeout.",
      });
    }
  });
}

module.exports = { rerankEndpoints };
