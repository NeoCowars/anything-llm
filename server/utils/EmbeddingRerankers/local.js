const ModelLibrary = require("../LocalModelLibrary");
const sessions = new Map();
const pending = new Map();
const classifiers = new Map();

async function load(model) {
  if (sessions.has(model.id)) return sessions.get(model.id);
  if (pending.has(model.id)) return pending.get(model.id);
  const task = (async () => {
    const release = ModelLibrary.acquire(model.id);
    try {
      const { AutoModelForSequenceClassification, AutoTokenizer } =
        await import("@xenova/transformers");
      // The library uses Transformers.js's cache layout: <root>/<id>/<file>.
      // This works across Windows drives without changing shared env settings.
      const location = model.id;
      const options = {
        local_files_only: true,
        quantized: model.quantized,
        cache_dir: ModelLibrary.root(),
      };
      let classifier = classifiers.get(model.id);
      if (!classifier) {
        classifier = await AutoModelForSequenceClassification.from_pretrained(
          location,
          options
        );
        classifiers.set(model.id, classifier);
      }
      ModelLibrary.markLoaded(model.id);
      const tokenizer = await AutoTokenizer.from_pretrained(location, options);
      const session = { classifier, tokenizer };
      sessions.set(model.id, session);
      return session;
    } finally {
      release();
    }
  })();
  pending.set(model.id, task);
  try {
    return await task;
  } finally {
    pending.delete(model.id);
  }
}

class LocalEmbeddingReranker {
  constructor(id) {
    this.model = ModelLibrary.getModel(id, "reranker");
  }
  async rerank(query, documents) {
    const { classifier, tokenizer } = await load(this.model);
    const scored = [];
    for (let offset = 0; offset < documents.length; offset += 5) {
      const batch = documents.slice(offset, offset + 5);
      const inputs = tokenizer(
        batch.map(() => query),
        {
          text_pair: batch.map((document) => document.text),
          padding: true,
          truncation: true,
        }
      );
      const { logits } = await classifier(inputs);
      logits
        .sigmoid()
        .tolist()
        .forEach(([score], index) =>
          scored.push({
            rerank_corpus_id: offset + index,
            rerank_score: score,
          })
        );
    }
    return scored.sort((a, b) => b.rerank_score - a.rerank_score);
  }
}
module.exports = { LocalEmbeddingReranker };
