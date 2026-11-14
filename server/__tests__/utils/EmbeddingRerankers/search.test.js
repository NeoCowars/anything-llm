const mockRerank = jest.fn();
jest.mock("../../../utils/EmbeddingRerankers", () => ({
  rerank: (...args) => mockRerank(...args),
}));
jest.mock("../../../utils/helpers", () => ({}));
jest.mock("../../../utils/TextSplitter", () => ({}));
jest.mock("../../../models/systemSettings", () => ({}));
jest.mock("../../../utils/files", () => ({}));
jest.mock("../../../utils/http", () => ({}));
jest.mock("../../../utils/chats", () => ({
  sourceIdentifier: (doc) => doc.title,
}));
jest.mock("@lancedb/lancedb", () => ({}));
jest.mock("chromadb", () => ({}));
jest.mock("@zilliz/milvus2-sdk-node", () => ({}));
const { LanceDb } = require("../../../utils/vectorDbProviders/lance");
const { Chroma } = require("../../../utils/vectorDbProviders/chroma");
const { Milvus } = require("../../../utils/vectorDbProviders/milvus");
const { ENV_KEYS } = require("../../../utils/EmbeddingRerankers/config");
const { VectorDatabase } = require("../../../utils/vectorDbProviders/base");
const originalEnv = { ...process.env };
const rows = [
  { id: "low", title: "low", text: "低向量相似度", score: 0.2 },
  { id: "pinned", title: "pinned", text: "固定文档", score: 0.99 },
  { id: "general", title: "general", text: "正式员工补贴", score: 0.9 },
  { id: "correct", title: "correct", text: "试用期没有补贴", score: 0.8 },
];

function fixture(Provider) {
  const db = new Provider();
  const trace = {};
  const subset = (count) => {
    trace.limit = count;
    return rows.slice(0, count);
  };
  const table = {
    vectorSearch: () => ({
      distanceType() {
        return this;
      },
      limit(count) {
        trace.limit = count;
        return this;
      },
      async toArray() {
        return subset(trace.limit).map((r) => ({
          ...r,
          _distance: 1 - r.score,
        }));
      },
    }),
  };
  const client = {
    openTable: async () => table,
    getCollection: async () => ({
      query: async ({ nResults }) => {
        const selected = subset(nResults);
        return {
          ids: [selected.map((r) => r.id)],
          documents: [selected.map((r) => r.text)],
          metadatas: [selected],
          distances: [selected.map((r) => 1 - r.score)],
        };
      },
    }),
    search: async ({ limit }) => ({
      results: subset(limit).map((r) => ({ metadata: r, score: r.score })),
    }),
  };
  db.connect = async () => ({ client });
  db.namespaceExists = async () => true;
  db.logger = jest.fn();
  return { db, trace };
}
const params = {
  namespace: "support",
  input: "试用期？",
  LLMConnector: { embedTextInput: async () => [1, 0] },
  topN: 1,
  similarityThreshold: 0.25,
  filterIdentifiers: ["pinned"],
  rerank: true,
};
beforeEach(() => {
  for (const env of Object.values(ENV_KEYS)) delete process.env[env];
  process.env.RERANK_CANDIDATE_COUNT = "30";
  mockRerank.mockReset().mockResolvedValue([
    { index: 1, score: 0.99 },
    { index: 0, score: 0.7 },
  ]);
});
afterEach(() => {
  process.env = { ...originalEnv };
});

describe.each([LanceDb, Chroma, Milvus])("%p shared reranking", (Provider) => {
  test("filters before reranking, expands candidates and preserves matching citations", async () => {
    const { db, trace } = fixture(Provider);
    const result = await db.performSimilaritySearch(params);
    expect(trace.limit).toBe(30);
    expect(mockRerank.mock.calls[0][1]).toEqual([
      { text: "正式员工补贴" },
      { text: "试用期没有补贴" },
    ]);
    expect(result.contextTexts).toEqual(["试用期没有补贴"]);
    expect(result.sources[0]).toMatchObject({
      title: "correct",
      text: "试用期没有补贴",
      rerankScore: 0.99,
    });
    expect(result.rerank.status).toBe("applied");
  });
  test("reranker failure keeps existing candidates and trims to final count", async () => {
    mockRerank.mockRejectedValue(new Error("private error payload"));
    const { db } = fixture(Provider);
    const result = await db.performSimilaritySearch(params);
    expect(result.contextTexts).toEqual(["正式员工补贴"]);
    expect(result.sources[0].title).toBe("general");
    expect(result.rerank.status).toBe("fallback");
    expect(JSON.stringify(db.logger.mock.calls)).not.toContain("private error");
  });
  test("disabled mode retains original retrieval behavior", async () => {
    const { db, trace } = fixture(Provider);
    await db.performSimilaritySearch({ ...params, rerank: false });
    expect(trace.limit).toBe(1);
    expect(mockRerank).not.toHaveBeenCalled();
  });
  test("candidate budget is at least the final count", async () => {
    const { db, trace } = fixture(Provider);
    await db.performSimilaritySearch({ ...params, topN: 40 });
    expect(trace.limit).toBe(40);
  });
  test("empty results do not load the model", async () => {
    const { db } = fixture(Provider);
    const result = await db.performSimilaritySearch({
      ...params,
      similarityThreshold: 1,
    });
    expect(result.contextTexts).toEqual([]);
    expect(mockRerank).not.toHaveBeenCalled();
  });
});
test("unsupported providers keep their raw retrieval path", async () => {
  class Other extends VectorDatabase {
    get name() {
      return "Other";
    }
    async performSimilaritySearch(parameters) {
      return parameters;
    }
  }
  expect((await new Other().performSimilaritySearch(params)).rerank).toBe(
    false
  );
  expect(mockRerank).not.toHaveBeenCalled();
});
