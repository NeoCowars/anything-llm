const { getSettings } = require("./config");

// Native inference cannot be aborted. Keep one call in flight even after a timeout.
let nativeBusy = false;

function validateRanking(rows, count, provider) {
  if (!Array.isArray(rows) || rows.length !== count)
    throw new Error("Rerank service must score every candidate.");
  const seen = new Set();
  const ranking = rows.map((row) => {
    const index = provider === "native" ? row.rerank_corpus_id : row.index;
    const score =
      provider === "cohere"
        ? row.relevance_score
        : provider === "native"
          ? row.rerank_score
          : row.score;
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= count ||
      seen.has(index) ||
      typeof score !== "number" ||
      !Number.isFinite(score)
    )
      throw new Error("Invalid candidate index or score in rerank response.");
    seen.add(index);
    return { index, score };
  });
  return ranking.sort((a, b) => b.score - a.score);
}

async function rerank(query, documents, settings = getSettings()) {
  if (
    typeof query !== "string" ||
    !query.trim() ||
    !Array.isArray(documents) ||
    !documents.length ||
    documents.some((doc) => typeof doc.text !== "string" || !doc.text.trim())
  )
    throw new Error("Rerank requires a query and non-empty candidate texts.");

  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Rerank request timed out."));
    }, Number(settings.RerankTimeoutMs));
  });

  const request = async () => {
    if (settings.RerankProvider === "native") {
      if (nativeBusy) throw new Error("Native reranker is busy.");
      nativeBusy = true;
      try {
        const { NativeEmbeddingReranker } = require("./native");
        const rows = await new NativeEmbeddingReranker().rerank(
          query,
          documents.map(({ text }) => ({ text })),
          { topK: documents.length }
        );
        return validateRanking(rows, documents.length, "native");
      } finally {
        nativeBusy = false;
      }
    }

    const cohere = settings.RerankProvider === "cohere";
    const body = cohere
      ? {
          model: settings.RerankModel,
          query,
          documents: documents.map((doc) => doc.text),
          top_n: documents.length,
        }
      : {
          query,
          texts: documents.map((doc) => doc.text),
          truncate: true,
          raw_scores: false,
          return_text: false,
        };
    const response = await fetch(settings.RerankEndpoint, {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(settings.RerankApiKey
          ? { Authorization: `Bearer ${settings.RerankApiKey}` }
          : {}),
      },
      body: JSON.stringify(body),
    });
    // Do not log response bodies: servers may echo keys or document contents.
    if (!response.ok)
      throw new Error(`Rerank service returned HTTP ${response.status}.`);
    const data = await response.json();
    return validateRanking(
      cohere ? data?.results : data,
      documents.length,
      settings.RerankProvider
    );
  };
  try {
    return await Promise.race([request(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { rerank, validateRanking };
