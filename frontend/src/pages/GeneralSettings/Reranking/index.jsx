import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/SettingsSidebar";
import Reranking from "@/models/reranking";
import LocalModels from "@/models/localModels";
import showToast from "@/utils/toast";
import paths from "@/utils/paths";

const inputClass =
  "w-full border-none bg-theme-settings-input-bg text-white text-sm rounded-lg p-2.5 focus:outline-primary-button";
const buttonClass =
  "rounded-lg bg-primary-button text-white px-4 py-2 text-sm disabled:opacity-50";

function Field({ id, label, children }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      {children}
    </div>
  );
}

export default function RerankingSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(null);
  const [localModels, setLocalModels] = useState([]);
  const [loadError, setLoadError] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const formRef = useRef(null);

  useEffect(() => {
    let active = true;
    Promise.all([Reranking.get(), LocalModels.list()])
      .then(([data, library]) => {
        if (active) {
          setSettings(data.settings);
          setLocalModels(
            library.models.filter((model) => model.kind === "reranker")
          );
        }
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const change = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setResult(null);
  };
  const payload = () => ({
    ...settings,
    ...(clearKey
      ? { RerankApiKey: "" }
      : apiKey
        ? { RerankApiKey: apiKey }
        : {}),
  });
  const perform = async (action) => {
    if (!formRef.current.reportValidity()) return;
    setBusy(action);
    setResult(null);
    try {
      if (action === "save") {
        const data = await Reranking.save(payload());
        setSettings(data.settings);
        setApiKey("");
        setClearKey(false);
        showToast(t("reranking:saved"), "success");
      } else setResult(await Reranking.test(payload()));
    } catch (error) {
      showToast(`${t("reranking:failed")} ${error.message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-zinc-950 light:bg-slate-50 flex">
      <Sidebar />
      <main className="relative w-full overflow-y-auto bg-zinc-900 light:bg-white text-white light:text-slate-900 m-0 md:m-4 md:rounded-2xl px-5 py-20 md:p-8">
        <div className="max-w-3xl flex flex-col gap-5">
          <h1 className="text-xl font-bold">{t("reranking:title")}</h1>
          <p className="text-sm opacity-70">{t("reranking:description")}</p>
          <p className="text-sm opacity-70">{t("reranking:workspaceHint")}</p>
          {loadError && <p role="alert">{t("reranking:loadFailed")}</p>}
          {!settings && !loadError && <p>{t("reranking:loading")}</p>}
          {settings && (
            <form
              ref={formRef}
              onSubmit={(event) => {
                event.preventDefault();
                perform("save");
              }}
              className="flex flex-col gap-5"
            >
              <fieldset
                disabled={!!busy}
                className="flex flex-col gap-5 disabled:opacity-70"
              >
                <Field id="rerank-provider" label={t("reranking:provider")}>
                  <select
                    id="rerank-provider"
                    className={inputClass}
                    value={settings.RerankProvider}
                    onChange={(event) =>
                      change("RerankProvider", event.target.value)
                    }
                  >
                    <option value="native">{t("reranking:native")}</option>
                    <option value="local">{t("reranking:local")}</option>
                    <option value="openai-rerank">
                      {t("reranking:openaiRerank")}
                    </option>
                    <option value="openai">{t("reranking:openaiChat")}</option>
                    <option value="cohere">{t("reranking:cohere")}</option>
                    <option value="tei">{t("reranking:tei")}</option>
                  </select>
                </Field>
                {settings.RerankProvider === "native" ? (
                  <>
                    <Field
                      id="rerank-native-model"
                      label={t("reranking:model")}
                    >
                      <input
                        id="rerank-native-model"
                        className={inputClass}
                        value="Xenova/ms-marco-MiniLM-L-6-v2"
                        readOnly
                      />
                    </Field>
                    <p className="text-sm opacity-70">
                      {t("reranking:nativeHint")}
                    </p>
                  </>
                ) : settings.RerankProvider === "local" ? (
                  <>
                    <Field id="rerank-local-model" label={t("reranking:model")}>
                      <select
                        id="rerank-local-model"
                        className={inputClass}
                        required
                        value={settings.RerankLocalModel || ""}
                        onChange={(event) =>
                          change("RerankLocalModel", event.target.value)
                        }
                      >
                        <option value="">{t("reranking:chooseLocal")}</option>
                        {localModels.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <p className="text-sm opacity-70">
                      {t("reranking:localHint")}
                    </p>
                    <a
                      className="text-sm underline"
                      href={paths.settings.localModels()}
                    >
                      {t("localModels:manage")}
                    </a>
                  </>
                ) : (
                  <>
                    <Field id="rerank-endpoint" label={t("reranking:endpoint")}>
                      <input
                        id="rerank-endpoint"
                        type="url"
                        className={inputClass}
                        value={settings.RerankEndpoint}
                        onChange={(event) =>
                          change("RerankEndpoint", event.target.value)
                        }
                        placeholder={
                          settings.RerankProvider === "tei"
                            ? "http://localhost:8080/rerank"
                            : settings.RerankProvider === "openai"
                              ? "http://localhost:8080/v1/chat/completions"
                              : settings.RerankProvider === "openai-rerank"
                                ? "http://localhost:8080/v1/rerank"
                                : "https://api.cohere.com/v2/rerank"
                        }
                        required
                      />
                    </Field>
                    {settings.RerankProvider !== "tei" ? (
                      <Field id="rerank-model" label={t("reranking:model")}>
                        <input
                          id="rerank-model"
                          className={inputClass}
                          value={settings.RerankModel}
                          onChange={(event) =>
                            change("RerankModel", event.target.value)
                          }
                          placeholder="BAAI/bge-reranker-v2-m3"
                          required
                        />
                      </Field>
                    ) : (
                      <p className="text-sm opacity-70">
                        {t("reranking:teiHint")}
                      </p>
                    )}
                    {["openai", "openai-rerank"].includes(
                      settings.RerankProvider
                    ) && (
                      <p className="text-sm opacity-70">
                        {t(
                          `reranking:${settings.RerankProvider === "openai" ? "openaiChatHint" : "openaiRerankHint"}`
                        )}
                      </p>
                    )}
                    <Field id="rerank-key" label={t("reranking:apiKey")}>
                      <input
                        id="rerank-key"
                        type="password"
                        autoComplete="new-password"
                        className={inputClass}
                        value={apiKey}
                        onChange={(event) => {
                          setApiKey(event.target.value);
                          setClearKey(false);
                          setResult(null);
                        }}
                        placeholder={
                          settings.RerankApiKeySet
                            ? t("reranking:keyStored")
                            : t("reranking:optional")
                        }
                      />
                    </Field>
                    {settings.RerankApiKeySet && (
                      <label className="text-sm flex gap-2 items-center">
                        <input
                          type="checkbox"
                          checked={clearKey}
                          onChange={(event) => {
                            setClearKey(event.target.checked);
                            setApiKey("");
                            setResult(null);
                          }}
                        />
                        {t("reranking:clearKey")}
                      </label>
                    )}
                  </>
                )}
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field
                    id="rerank-candidates"
                    label={t("reranking:candidates")}
                  >
                    <input
                      id="rerank-candidates"
                      className={inputClass}
                      type="number"
                      min="1"
                      max="200"
                      step="1"
                      value={settings.RerankCandidateCount}
                      onChange={(event) =>
                        change("RerankCandidateCount", event.target.value)
                      }
                      required
                    />
                  </Field>
                  <Field id="rerank-timeout" label={t("reranking:timeout")}>
                    <input
                      id="rerank-timeout"
                      className={inputClass}
                      type="number"
                      min="100"
                      max="120000"
                      step="1"
                      value={settings.RerankTimeoutMs}
                      onChange={(event) =>
                        change("RerankTimeoutMs", event.target.value)
                      }
                      required
                    />
                  </Field>
                </div>
                <p className="text-sm opacity-70">
                  {t("reranking:candidatesHint")}
                </p>
                <p className="text-sm opacity-70">
                  {t("reranking:fallbackHint")}
                </p>
                <p className="text-sm opacity-70">{t("reranking:testHint")}</p>
                <div className="flex flex-wrap gap-3">
                  <button type="submit" className={buttonClass}>
                    {busy === "save"
                      ? t("reranking:saving")
                      : t("reranking:save")}
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => perform("test")}
                  >
                    {busy === "test"
                      ? t("reranking:testing")
                      : t("reranking:test")}
                  </button>
                  <a
                    className="text-sm underline self-center"
                    href={paths.settings.embedder.modelPreference()}
                  >
                    {t("reranking:embeddingLink")}
                  </a>
                </div>
              </fieldset>
            </form>
          )}
          {result && (
            <section
              aria-live="polite"
              className="rounded-lg border border-white/20 light:border-slate-300 p-4 flex flex-col gap-3"
            >
              <p className="font-semibold">
                {t("reranking:testResult", { ms: result.elapsedMs })}
              </p>
              <p className="text-sm">{result.query}</p>
              <ol className="list-decimal pl-5 flex flex-col gap-3">
                {result.results.map((row) => (
                  <li key={row.index}>
                    <p>{row.text}</p>
                    <p className="text-sm opacity-70">
                      {t("reranking:score")}: {row.score.toFixed(4)}
                    </p>
                  </li>
                ))}
              </ol>
              <p className="text-xs opacity-70">{t("reranking:scoreHint")}</p>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
