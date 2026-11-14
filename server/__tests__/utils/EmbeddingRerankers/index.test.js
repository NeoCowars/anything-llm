const http = require("http");
const mockNative = jest.fn();
jest.mock("../../../utils/EmbeddingRerankers/native", () => ({
  NativeEmbeddingReranker: jest
    .fn()
    .mockImplementation(() => ({ rerank: mockNative })),
}));
const {
  rerank,
  validateRanking,
} = require("../../../utils/EmbeddingRerankers");
const { mergeSettings } = require("../../../utils/EmbeddingRerankers/config");
let server, endpoint, handler;
const docs = [{ text: "正式员工补贴300元" }, { text: "试用期无补贴" }];
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let text = "";
    for await (const part of req) text += part;
    handler(req, res, JSON.parse(text));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${server.address().port}/rerank`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
function config(provider, overrides = {}) {
  return mergeSettings({
    RerankProvider: provider,
    RerankEndpoint: endpoint,
    RerankModel: "fixture-model",
    ...overrides,
  });
}
test("Cohere contract uses text documents, model, all candidates and bearer auth", async () => {
  handler = (req, res, body) => {
    expect(req.headers.authorization).toBe("Bearer fixture-token");
    expect(body).toEqual({
      model: "fixture-model",
      query: "试用期？",
      documents: docs.map((doc) => doc.text),
      top_n: 2,
    });
    res.end(
      JSON.stringify({
        results: [
          { index: 0, relevance_score: 0 },
          { index: 1, relevance_score: 0.9 },
        ],
      })
    );
  };
  expect(
    await rerank(
      "试用期？",
      docs,
      config("cohere", { RerankApiKey: "fixture-token" })
    )
  ).toEqual([
    { index: 1, score: 0.9 },
    { index: 0, score: 0 },
  ]);
});
test("TEI contract omits a model name and maps scores by index", async () => {
  handler = (_req, res, body) => {
    expect(body).toEqual({
      query: "试用期？",
      texts: docs.map((doc) => doc.text),
      truncate: true,
      raw_scores: false,
      return_text: false,
    });
    res.end(
      JSON.stringify([
        { index: 1, score: 0.8 },
        { index: 0, score: 0.2 },
      ])
    );
  };
  expect((await rerank("试用期？", docs, config("tei")))[0].index).toBe(1);
});
test("HTTP errors do not expose a service response containing secrets", async () => {
  handler = (_req, res) => {
    res.writeHead(401);
    res.end("fixture-token private document text");
  };
  await expect(rerank("query", docs, config("cohere"))).rejects.toThrow(
    "HTTP 401"
  );
});
test("a hung HTTP service is aborted within the configured timeout", async () => {
  handler = () => {};
  await expect(
    rerank("query", docs, config("tei", { RerankTimeoutMs: 100 }))
  ).rejects.toThrow("timed out");
});
test.each([
  [
    { index: 0, score: 0.8 },
    { index: 0, score: 0.2 },
  ],
  [
    { index: 0, score: 0.8 },
    { index: 3, score: 0.2 },
  ],
  [{ index: 0, score: 0.8 }],
  [
    { index: 0, score: "0.8" },
    { index: 1, score: 0.2 },
  ],
])("rejects invalid TEI rankings %j", (rows) => {
  expect(() => validateRanking(rows, 2, "tei")).toThrow();
});
test("native timeout does not enqueue overlapping inference; later calls recover", async () => {
  let finish;
  mockNative.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const settings = config("native", { RerankTimeoutMs: 100 });
  await expect(rerank("q", docs, settings)).rejects.toThrow("timed out");
  await expect(rerank("q", docs, settings)).rejects.toThrow("busy");
  finish([
    { rerank_corpus_id: 0, rerank_score: 0.2 },
    { rerank_corpus_id: 1, rerank_score: 0.8 },
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  mockNative.mockResolvedValueOnce([
    { rerank_corpus_id: 0, rerank_score: 0.2 },
    { rerank_corpus_id: 1, rerank_score: 0.8 },
  ]);
  expect((await rerank("q", docs, settings))[0].index).toBe(1);
});
