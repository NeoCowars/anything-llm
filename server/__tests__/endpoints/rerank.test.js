const http = require("http");
const express = require("express");
const mockRerank = jest.fn();
const mockPersist = jest.fn();
jest.mock("../../models/systemSettings", () => ({
  SystemSettings: { isMultiUserMode: async () => true },
}));
jest.mock("../../utils/middleware/validatedRequest", () => ({
  validatedRequest: (req, res, next) => {
    res.locals.multiUserMode = true;
    res.locals.user = { role: req.headers["x-test-role"] || "default" };
    next();
  },
}));
jest.mock("../../utils/http", () => ({
  reqBody: (req) => req.body,
  userFromSession: async (_req, res) => res.locals.user,
}));
jest.mock("../../utils/EmbeddingRerankers", () => ({
  rerank: (...args) => mockRerank(...args),
}));
jest.mock("../../utils/EmbeddingRerankers/config", () => ({
  ...jest.requireActual("../../utils/EmbeddingRerankers/config"),
  persistDevelopmentSettings: (...args) => mockPersist(...args),
}));
jest.mock("../../utils/helpers/updateENV", () => ({
  updateENV: async (settings) => {
    const { ENV_KEYS } = require("../../utils/EmbeddingRerankers/config");
    for (const [key, value] of Object.entries(settings))
      process.env[ENV_KEYS[key]] = String(value);
    return { error: false };
  },
}));
const { rerankEndpoints } = require("../../endpoints/rerank");
const { ENV_KEYS } = require("../../utils/EmbeddingRerankers/config");
const originalEnv = { ...process.env };
let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  rerankEndpoints(app);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/system/`;
});
beforeEach(() => {
  for (const env of Object.values(ENV_KEYS)) delete process.env[env];
  process.env.RERANK_API_KEY = "stored-fixture-secret";
  mockPersist.mockReset();
  mockRerank.mockReset().mockResolvedValue([
    { index: 1, score: 0.9 },
    { index: 0, score: 0.4 },
    { index: 2, score: 0.1 },
  ]);
});
afterEach(() => {
  process.env = { ...originalEnv };
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
async function request(path, settings, role = "admin") {
  return fetch(base + path, {
    method: settings ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-test-role": role },
    ...(settings ? { body: JSON.stringify(settings) } : {}),
  });
}
test.each([
  ["rerank-settings", undefined],
  ["rerank-settings", { RerankProvider: "native" }],
  ["rerank-test", { RerankProvider: "native" }],
])("non-admin cannot access %s", async (path, settings) => {
  expect((await request(path, settings, "default")).status).toBe(401);
});
test("admin reads masked settings and saves provider changes without resetting embeddings", async () => {
  const read = await (await request("rerank-settings")).json();
  expect(read.settings.RerankApiKeySet).toBe(true);
  expect(JSON.stringify(read)).not.toContain("stored-fixture-secret");
  const saved = await request("rerank-settings", {
    RerankProvider: "cohere",
    RerankEndpoint: "http://localhost:8080/rerank",
    RerankModel: "bge-fixture",
  });
  expect(saved.status).toBe(200);
  expect(JSON.stringify(await saved.json())).not.toContain(
    "stored-fixture-secret"
  );
  expect(process.env.RERANK_MODEL).toBe("bge-fixture");
  expect(process.env.RERANK_API_KEY).toBe("stored-fixture-secret");
  const cleared = await (
    await request("rerank-settings", { RerankApiKey: "" })
  ).json();
  expect(cleared.settings.RerankApiKeySet).toBe(false);
});
test("invalid configuration is rejected before persistence", async () => {
  expect(
    (await request("rerank-settings", { RerankCandidateCount: 0 })).status
  ).toBe(400);
  expect(mockPersist).not.toHaveBeenCalled();
});
test("connection test uses unsaved settings and fixed samples, without persisting", async () => {
  const response = await request("rerank-test", {
    RerankProvider: "tei",
    RerankEndpoint: "http://localhost:8080/rerank",
    RerankApiKey: "unsaved-fixture-secret",
  });
  const data = await response.json();
  expect(response.status).toBe(200);
  expect(data.results[0].text).toContain("试用期");
  expect(mockRerank.mock.calls[0][2].RerankApiKey).toBe(
    "unsaved-fixture-secret"
  );
  expect(process.env.RERANK_API_KEY).toBe("stored-fixture-secret");
  expect(JSON.stringify(data)).not.toContain("secret");
  expect(mockPersist).not.toHaveBeenCalled();
});
test("connection errors never echo remote errors or secrets", async () => {
  mockRerank.mockRejectedValue(new Error("stored-fixture-secret private text"));
  const response = await request("rerank-test", { RerankProvider: "native" });
  expect(response.status).toBe(502);
  expect(JSON.stringify(await response.json())).not.toContain(
    "stored-fixture-secret"
  );
});
