const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const express = require("express");
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
  userFromSession: async (_req, res) => res.locals.user,
}));
const { localModelEndpoints } = require("../../endpoints/localModels");
const library = require("../../utils/LocalModelLibrary");
const originalEnv = { ...process.env };
let server, base, directory;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post("/fixture/v1/embeddings", (req, res) => {
    expect(req.body).toEqual({
      model: "unsaved-e5",
      input: ["本地和远端模型连接测试"],
      encoding_format: "float",
    });
    res.json({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] });
  });
  localModelEndpoints(app);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}/system/`;
});
beforeEach(() => {
  directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "anything-model-endpoint-")
  );
  process.env.STORAGE_DIR = directory;
});
afterEach(() => {
  process.env = { ...originalEnv };
  fs.rmSync(directory, { recursive: true, force: true });
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
function request(url, method = "GET", body, role = "admin") {
  return fetch(base + url, {
    method,
    headers: { "x-test-role": role },
    ...(body ? { body } : {}),
  });
}
function upload(pathsOverride) {
  const source = path.resolve(__dirname, "../fixtures/local-models/embedding");
  const names = fs
    .readdirSync(source, { recursive: true })
    .filter((name) => fs.statSync(path.join(source, name)).isFile());
  const form = new FormData();
  form.set("name", "中文 embedding");
  form.set("kind", "embedding");
  form.set(
    "paths",
    JSON.stringify(
      pathsOverride || names.map((name) => name.split(path.sep).join("/"))
    )
  );
  for (const name of names)
    form.append(
      "files",
      new Blob([fs.readFileSync(path.join(source, name))]),
      path.basename(name)
    );
  return form;
}
test.each([
  ["local-models", "GET"],
  ["local-models/import", "POST"],
  ["local-models/id", "DELETE"],
  ["local-models/id/test", "POST"],
  ["embedding-test", "POST"],
])("admin protects %s", async (url, method) => {
  expect((await request(url, method, undefined, "default")).status).toBe(401);
});
test("real multipart import, list and delete clean the library and upload staging", async () => {
  const response = await request("local-models/import", "POST", upload());
  expect(response.status).toBe(201);
  const { model } = await response.json();
  const list = await (await request("local-models")).json();
  expect(list.models[0].name).toBe("中文 embedding");
  expect(list.models[0]).not.toHaveProperty("modelPath");
  expect(
    fs.readdirSync(library.root()).some((name) => name.startsWith(".upload-"))
  ).toBe(false);
  expect((await request(`local-models/${model.id}`, "DELETE")).status).toBe(
    200
  );
  expect(library.listModels()).toHaveLength(0);
});
test("failed import cleans staging and creates no registry", async () => {
  const response = await request(
    "local-models/import",
    "POST",
    upload(["../evil.json"])
  );
  expect(response.status).toBe(400);
  expect(library.listModels()).toEqual([]);
  expect(fs.readdirSync(library.root())).toEqual([]);
});
test("invalid model test returns a controlled error", async () => {
  expect(
    (await request("local-models/local-missing/test", "POST")).status
  ).toBe(422);
});

test("unsaved embedding connection test does not modify the active model or expose its key", async () => {
  process.env.EMBEDDING_MODEL_PREF = "active-model";
  process.env.GENERIC_OPEN_AI_EMBEDDING_API_KEY = "stored-test-key";
  const response = await fetch(base + "embedding-test", {
    method: "POST",
    headers: { "x-test-role": "admin", "Content-Type": "application/json" },
    body: JSON.stringify({
      basePath: base.replace("/system/", "/fixture/v1"),
      model: "unsaved-e5",
      apiKey: "********************",
    }),
  });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.dimensions).toBe(3);
  expect(JSON.stringify(result)).not.toContain("stored-test-key");
  expect(process.env.EMBEDDING_MODEL_PREF).toBe("active-model");
});
