const fs = require("fs");
const {
  ENV_KEYS,
  getSettings,
  mergeSettings,
  safeSettings,
  persistDevelopmentSettings,
} = require("../../../utils/EmbeddingRerankers/config");
const originalEnv = { ...process.env };

beforeEach(() => {
  for (const env of Object.values(ENV_KEYS)) delete process.env[env];
});
afterEach(() => {
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

test("default native settings are usable without a service", () => {
  expect(getSettings()).toMatchObject({
    RerankProvider: "native",
    RerankCandidateCount: 30,
    RerankTimeoutMs: 15000,
  });
});
test("secret is preserved, masked in responses, and explicitly clearable", () => {
  process.env.RERANK_API_KEY = "fixture-secret";
  expect(safeSettings()).not.toHaveProperty("RerankApiKey");
  expect(safeSettings().RerankApiKeySet).toBe(true);
  expect(mergeSettings({ RerankApiKey: "*****" }).RerankApiKey).toBe(
    "fixture-secret"
  );
  expect(mergeSettings({ RerankApiKey: "" }).RerankApiKey).toBe("");
});
test.each([
  { RerankProvider: "other" },
  { RerankCandidateCount: 0 },
  { RerankCandidateCount: 201 },
  { RerankCandidateCount: 1.5 },
  { RerankCandidateCount: true },
  { RerankCandidateCount: [30] },
  { RerankTimeoutMs: 99 },
  { RerankTimeoutMs: 120001 },
  { RerankEndpoint: "file:///tmp/model" },
  { RerankEndpoint: "https://user:pass@example.com/rerank" },
  { RerankApiKey: "secret\nINJECT=value" },
  { RerankApiKey: "secret'quoted" },
  { RerankApiKey: "secret\ttruncated" },
  { RerankModel: "model\u2028truncated" },
  { RerankProvider: "cohere", RerankEndpoint: "http://localhost:8080/rerank" },
  { RerankProvider: "tei" },
])("rejects invalid configuration %j", (settings) => {
  expect(() => mergeSettings(settings)).toThrow();
});
test("numeric form values are normalized before saving", () => {
  expect(
    mergeSettings({ RerankCandidateCount: "30", RerankTimeoutMs: "15000" })
  ).toMatchObject({ RerankCandidateCount: 30, RerankTimeoutMs: 15000 });
});

test("invalid environment can be inspected and repaired", () => {
  process.env.RERANK_PROVIDER = "bad";
  expect(() => getSettings()).toThrow();
  expect(safeSettings().RerankProvider).toBe("bad");
  expect(mergeSettings({ RerankProvider: "native" }).RerankProvider).toBe(
    "native"
  );
});
test("development saves retain other environment settings and replace existing keys", () => {
  process.env.NODE_ENV = "development";
  jest.spyOn(fs, "existsSync").mockReturnValue(true);
  jest
    .spyOn(fs, "readFileSync")
    .mockReturnValue("LLM_PROVIDER=fixture\nRERANK_PROVIDER='tei'\n");
  const write = jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
  const rename = jest.spyOn(fs, "renameSync").mockImplementation(() => {});
  jest.spyOn(fs, "unlinkSync").mockImplementation(() => {});
  persistDevelopmentSettings(mergeSettings({ RerankProvider: "native" }));
  const saved = write.mock.calls[0][1];
  expect(saved).toContain("LLM_PROVIDER=fixture");
  expect(saved.match(/RERANK_PROVIDER=/g)).toHaveLength(1);
  expect(saved).toContain("RERANK_PROVIDER='native'");
  expect(rename).toHaveBeenCalled();
});
