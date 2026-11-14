const { getSettings } = require("./config");
const { rerank } = require(".");

const SUPPORTED_DATABASES = ["LanceDb", "Chroma", "Milvus"];

function selectResults(result, indices, ranking = null) {
  return {
    ...result,
    contextTexts: indices.map((index) => result.contextTexts[index]),
    sources: indices.map((index) =>
      ranking
        ? {
            ...result.sources[index],
            retrievalScore: result.sources[index]?.score ?? null,
            rerankScore: ranking.find((row) => row.index === index).score,
          }
        : result.sources[index]
    ),
  };
}

// All eligible providers use the same post-retrieval stage. Raw retrieval keeps
// its workspace, source exclusions and similarity threshold before final Top K.
async function searchWithReranking(database, retrieve, params) {
  if (!params?.rerank || !SUPPORTED_DATABASES.includes(database.name))
    return retrieve({ ...params, rerank: false });

  const finalTopK = params.topN ?? 4;
  let settings;
  try {
    settings = getSettings();
  } catch {
    database.logger(
      "Reranking unavailable: invalid settings; using vector retrieval."
    );
    return retrieve({ ...params, rerank: false });
  }
  const result = await retrieve({
    ...params,
    rerank: false,
    topN: Math.max(finalTopK, settings.RerankCandidateCount),
  });
  if (result.message || !result.contextTexts.length) return result;
  const fallback = () =>
    selectResults(
      result,
      result.contextTexts.map((_, index) => index).slice(0, finalTopK)
    );
  try {
    if (result.sources.length !== result.contextTexts.length)
      throw new Error("Candidate text/source count mismatch.");
    const ranking = await rerank(
      params.input,
      result.contextTexts.map((text) => ({ text })),
      settings
    );
    return {
      ...selectResults(
        result,
        ranking.slice(0, finalTopK).map((row) => row.index),
        ranking
      ),
      rerank: { status: "applied", provider: settings.RerankProvider },
    };
  } catch {
    database.logger("Reranking unavailable; using vector retrieval order.");
    return {
      ...fallback(),
      rerank: { status: "fallback", provider: settings.RerankProvider },
    };
  }
}

module.exports = { searchWithReranking, SUPPORTED_DATABASES };
