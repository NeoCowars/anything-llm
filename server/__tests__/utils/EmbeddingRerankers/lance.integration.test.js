const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const lancedb = require("@lancedb/lancedb");

// Only unrelated ingestion helpers are stubbed. The vector database, provider,
// shared retrieval stage and HTTP reranking client below are real.
jest.mock("../../../utils/helpers", () => ({}));
jest.mock("../../../utils/TextSplitter", () => ({}));
jest.mock("../../../models/systemSettings", () => ({}));
jest.mock("../../../utils/files", () => ({}));
jest.mock("../../../utils/http", () => ({}));
const { LanceDb } = require("../../../utils/vectorDbProviders/lance");
const { ENV_KEYS } = require("../../../utils/EmbeddingRerankers/config");

const originalEnv = { ...process.env };
let directory, server, db, received;
let fail = false;
const params = {
  namespace: "benefits",
  input: "试用期员工可以领取交通补贴吗？",
  LLMConnector: { embedTextInput: async () => [1, 0] },
  similarityThreshold: 0.25,
  filterIdentifiers: ["title:固定文档-timestamp:2026-01-01"],
  topN: 1,
  rerank: true,
};

beforeAll(async () => {
  for (const env of Object.values(ENV_KEYS)) delete process.env[env];
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "anythingllm-rerank-"));
  const client = await lancedb.connect(directory);
  const rows = [
    ["pinned", "固定文档", "固定文档已单独加入上下文", [1, 0]],
    ["general", "正式员工", "正式员工每月享受交通补贴300元。", [0.99, 0.1]],
    ["correct", "试用期", "试用期员工不享受交通补贴。", [0.8, 0.6]],
    ["unrelated", "会议室", "会议室需要预约。", [0, 1]],
  ].map(([id, title, text, vector]) => ({
    id,
    title,
    text,
    vector,
    published: "2026-01-01",
  }));
  await client.createTable("benefits", rows);
  await client.createTable("another_workspace", [rows[2]]);
  db = new LanceDb();
  db.connect = async () => ({ client });
  db.logger = jest.fn();
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received = JSON.parse(body);
    res.setHeader("Content-Type", "application/json");
    if (fail) {
      res.writeHead(503);
      return res.end("{}");
    }
    // Deterministic protocol fixture, not a Chinese accuracy benchmark.
    res.end(
      JSON.stringify(
        received.texts.map((text, index) => ({
          index,
          score: text.includes("不享受") ? 0.95 : 0.4,
        }))
      )
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.RERANK_PROVIDER = "tei";
  process.env.RERANK_ENDPOINT = `http://127.0.0.1:${server.address().port}/rerank`;
  process.env.RERANK_CANDIDATE_COUNT = "4";
});

afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
  process.env = { ...originalEnv };
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

test("real LanceDB filters candidates, reranks over HTTP and keeps the correct citation", async () => {
  const result = await db.performSimilaritySearch(params);
  expect(received.texts).toEqual([
    "正式员工每月享受交通补贴300元。",
    "试用期员工不享受交通补贴。",
  ]);
  expect(result.contextTexts).toEqual(["试用期员工不享受交通补贴。"]);
  expect(result.sources[0]).toMatchObject({ id: "correct", rerankScore: 0.95 });
  expect(result.sources[0].retrievalScore).toBeCloseTo(0.8);
  expect(result.rerank.status).toBe("applied");
});

test("real LanceDB retains vector order when the HTTP reranker is unavailable", async () => {
  fail = true;
  const result = await db.performSimilaritySearch(params);
  expect(result.contextTexts).toEqual(["正式员工每月享受交通补贴300元。"]);
  expect(result.sources[0].id).toBe("general");
  expect(result.rerank.status).toBe("fallback");
});
