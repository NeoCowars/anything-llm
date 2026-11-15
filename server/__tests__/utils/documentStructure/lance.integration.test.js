const fs = require("fs");
const os = require("os");
const path = require("path");
const lancedb = require("@lancedb/lancedb");

jest.mock("../../../utils/helpers", () => ({
  toChunks: (items, size) =>
    Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
      items.slice(i * size, (i + 1) * size)
    ),
  getEmbeddingEngineSelection: jest.fn(),
}));
jest.mock("../../../models/systemSettings", () => ({
  SystemSettings: {
    getValueOrFallback: jest.fn(async ({ label }) =>
      label === "text_splitter_chunk_size" ? 180 : 10
    ),
  },
}));
jest.mock("../../../utils/files", () => ({
  storeVectorResult: jest.fn(),
  cachedVectorInformation: jest.fn(async () => ({ exists: false })),
}));
jest.mock("../../../models/vectors", () => ({
  DocumentVectors: { bulkInsert: jest.fn() },
}));
const { getEmbeddingEngineSelection } = require("../../../utils/helpers");
const { storeVectorResult } = require("../../../utils/files");
const { LanceDb } = require("../../../utils/vectorDbProviders/lance");
let directory;
let client;
let database;
let embedded;
beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "structure-lance-"));
  client = await lancedb.connect(directory);
  database = new LanceDb();
  database.connect = async () => ({ client });
  database.logger = jest.fn();
  embedded = [];
  getEmbeddingEngineSelection.mockReturnValue({
    embeddingMaxChunkLength: 180,
    embedChunks: async (chunks) => {
      embedded.push(...chunks);
      return chunks.map((_, i) => [1, i + 1]);
    },
  });
});
afterAll(() => {
  expect(path.dirname(directory)).toBe(path.resolve(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true });
});

test("real ingestion embeds and stores the structured CSV context as scalar vector metadata", async () => {
  const rows = Array.from({ length: 24 }, (_, i) => `岗位${i},${100 + i}元`);
  const result = await database.addDocumentToNamespace(
    "structure",
    {
      docId: "doc-1",
      title: "补贴.csv",
      documentFormat: "csv",
      pageContent: `岗位,每月交通补贴\n${rows.join("\n")}`,
    },
    "custom-documents/补贴.json",
    true
  );
  expect(result).toEqual({ vectorized: true, error: null });
  expect(embedded.length).toBeGreaterThan(1);
  expect(embedded.every((chunk) => chunk.length <= 180)).toBe(true);
  expect(embedded.every((chunk) => chunk.includes("岗位,每月交通补贴"))).toBe(
    true
  );
  const table = await client.openTable("structure");
  const stored = await table.query().toArray();
  expect(stored).toHaveLength(embedded.length);
  expect(
    stored.every(
      (row) => row.documentFormat === "csv" && typeof row.text === "string"
    )
  ).toBe(true);
  for (const source of rows)
    expect(stored.map((row) => row.text).join("\n")).toContain(source);
  expect(storeVectorResult).toHaveBeenCalled();
});
