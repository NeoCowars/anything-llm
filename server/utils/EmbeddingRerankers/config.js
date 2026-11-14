const PROVIDERS = [
  "native",
  "local",
  "cohere",
  "tei",
  "openai",
  "openai-rerank",
];
const DEFAULTS = {
  RerankProvider: "native",
  RerankEndpoint: "",
  RerankModel: "",
  RerankLocalModel: "",
  RerankCandidateCount: 30,
  RerankTimeoutMs: 15000,
};

const ENV_KEYS = {
  RerankProvider: "RERANK_PROVIDER",
  RerankEndpoint: "RERANK_ENDPOINT",
  RerankModel: "RERANK_MODEL",
  RerankLocalModel: "RERANK_LOCAL_MODEL",
  RerankApiKey: "RERANK_API_KEY",
  RerankCandidateCount: "RERANK_CANDIDATE_COUNT",
  RerankTimeoutMs: "RERANK_TIMEOUT_MS",
};

// Match dumpENV's storage restrictions so a value cannot change after restart.
function isSafeConfigString(value) {
  return (
    typeof value === "string" &&
    !/[\n\r\t\v\f\u0085\u00a0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000"'`#]/.test(
      value
    )
  );
}

function validateSettings(settings) {
  if (!PROVIDERS.includes(settings.RerankProvider))
    throw new Error("Unsupported rerank provider.");
  for (const [key, min, max] of [
    ["RerankCandidateCount", 1, 200],
    ["RerankTimeoutMs", 100, 120000],
  ]) {
    if (
      !["number", "string"].includes(typeof settings[key]) ||
      !Number.isInteger(Number(settings[key])) ||
      Number(settings[key]) < min ||
      Number(settings[key]) > max
    )
      throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  }
  for (const key of [
    "RerankEndpoint",
    "RerankModel",
    "RerankLocalModel",
    "RerankApiKey",
  ]) {
    if (!isSafeConfigString(settings[key]))
      throw new Error(
        `${key} must not contain control characters, special whitespace, quotes, backticks or #.`
      );
  }
  if (settings.RerankEndpoint) {
    let url;
    try {
      url = new URL(settings.RerankEndpoint);
    } catch {
      throw new Error("Invalid rerank endpoint URL.");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error(
        "Use an HTTP(S) rerank endpoint without URL credentials or fragments."
      );
  }
  if (
    !["native", "local"].includes(settings.RerankProvider) &&
    !settings.RerankEndpoint
  )
    throw new Error("A full rerank endpoint URL is required.");
  if (
    ["cohere", "openai", "openai-rerank"].includes(settings.RerankProvider) &&
    !settings.RerankModel.trim()
  )
    throw new Error("The API model name is required.");
  if (settings.RerankProvider === "local")
    require("../LocalModelLibrary").getModel(
      settings.RerankLocalModel,
      "reranker"
    );
  return settings;
}

function getSettings(validate = true) {
  const settings = { ...DEFAULTS, RerankApiKey: "" };
  for (const [key, env] of Object.entries(ENV_KEYS))
    if (process.env[env] !== undefined) settings[key] = process.env[env];
  settings.RerankCandidateCount = Number(settings.RerankCandidateCount);
  settings.RerankTimeoutMs = Number(settings.RerankTimeoutMs);
  return validate ? validateSettings(settings) : settings;
}

// A missing key preserves the stored secret. An explicit empty string clears it.
function mergeSettings(input = {}, current = getSettings(false)) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Rerank settings must be an object.");
  const settings = { ...current };
  for (const key of Object.keys(ENV_KEYS)) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    if (key === "RerankApiKey" && /^\*+$/.test(input[key])) continue;
    settings[key] = input[key];
  }
  validateSettings(settings);
  settings.RerankCandidateCount = Number(settings.RerankCandidateCount);
  settings.RerankTimeoutMs = Number(settings.RerankTimeoutMs);
  return settings;
}

function safeSettings(settings = getSettings(false)) {
  const { RerankApiKey, ...rest } = settings;
  return { ...rest, RerankApiKeySet: !!RerankApiKey };
}

// The existing updater persists production settings through dumpENV. During
// development the server reads .env.development instead; only replace our keys.
function persistDevelopmentSettings(settings) {
  if (process.env.NODE_ENV !== "development") return;
  const fs = require("fs");
  const path = require("path");
  const file = path.resolve(__dirname, "../../.env.development");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const lines = existing
    .split(/\r?\n/)
    .filter(
      (line) =>
        !Object.values(ENV_KEYS).some((key) =>
          new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`).test(line)
        )
    );
  const entries = Object.entries(ENV_KEYS).map(
    ([key, env]) => `${env}='${settings[key]}'`
  );
  const temp = `${file}.rerank-tmp`;
  try {
    fs.writeFileSync(temp, [...lines, ...entries, ""].join("\n"), {
      mode: 0o600,
    });
    fs.renameSync(temp, file);
  } finally {
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}

module.exports = {
  DEFAULTS,
  ENV_KEYS,
  getSettings,
  mergeSettings,
  safeSettings,
  validateSettings,
  persistDevelopmentSettings,
  isSafeConfigString,
};
