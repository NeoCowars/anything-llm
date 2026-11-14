const http = require("http");
const {
  GenericOpenAiEmbedder,
} = require("../../utils/EmbeddingEngines/genericOpenAi");
let server, basePath, reply, captured;
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    captured = { path: req.url, body: JSON.parse(body) };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: reply }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  basePath = `http://127.0.0.1:${server.address().port}/v1`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
test("uses the actual OpenAI SDK with an optional key, float encoding and indexed ordering", async () => {
  reply = [
    { index: 1, embedding: [3, 4] },
    { index: 0, embedding: [1, 2] },
  ];
  const engine = new GenericOpenAiEmbedder({
    basePath,
    model: "e5",
    apiKey: "",
  });
  expect(await engine.embedChunks(["正式员工", "试用期员工"])).toEqual([
    [1, 2],
    [3, 4],
  ]);
  expect(captured).toEqual({
    path: "/v1/embeddings",
    body: {
      model: "e5",
      input: ["正式员工", "试用期员工"],
      encoding_format: "float",
    },
  });
});
test.each([
  [{ index: 0, embedding: [1] }],
  [
    { index: 0, embedding: [1] },
    { index: 0, embedding: [2] },
  ],
  [
    { index: 0, embedding: [1] },
    { index: 3, embedding: [2] },
  ],
  [
    { index: 0, embedding: [1] },
    { index: 1, embedding: [2, 3] },
  ],
  [
    { index: 0, embedding: ["1"] },
    { index: 1, embedding: [2] },
  ],
])("rejects broken index/vector contracts %j", async (...rows) => {
  reply = rows;
  const engine = new GenericOpenAiEmbedder({
    basePath,
    model: "e5",
    apiKey: "",
  });
  await expect(engine.embedChunks(["a", "b"])).rejects.toThrow();
});
