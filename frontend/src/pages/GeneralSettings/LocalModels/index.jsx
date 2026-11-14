import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/SettingsSidebar";
import LocalModels from "@/models/localModels";
import paths from "@/utils/paths";
import showToast from "@/utils/toast";

const inputClass =
  "w-full border-none bg-theme-settings-input-bg text-theme-text-primary text-sm rounded-lg p-2.5";
const buttonClass =
  "rounded-lg bg-primary-button text-white px-4 py-2 text-sm disabled:opacity-50";
function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      {label}
      {children}
    </label>
  );
}

export default function LocalModelSettings() {
  const { t } = useTranslation();
  const [models, setModels] = useState(null);
  const [files, setFiles] = useState([]);
  const [kind, setKind] = useState("embedding");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const formRef = useRef(null);
  const refresh = async () => setModels((await LocalModels.list()).models);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  const perform = async (action, model) => {
    if (action === "import" && !formRef.current.reportValidity()) return;
    if (
      action === "delete" &&
      !window.confirm(t("localModels:confirmDelete", { name: model.name }))
    )
      return;
    setBusy(action === "import" ? "import" : model.id);
    setError("");
    setResult(null);
    setProgress(0);
    try {
      if (action === "import") {
        const body = new FormData(formRef.current);
        body.delete("folder");
        const paths = files.map((file) =>
          file.webkitRelativePath.split("/").slice(1).join("/")
        );
        body.set("paths", JSON.stringify(paths));
        body.set(
          "normalize",
          String(formRef.current.elements.normalize.checked)
        );
        for (const file of files) body.append("files", file, file.name);
        await LocalModels.import(body, setProgress);
        setFiles([]);
        setName("");
        formRef.current.elements.folder.value = "";
        showToast(t("localModels:imported"), "success");
      } else if (action === "delete") await LocalModels.remove(model.id);
      else
        setResult({
          id: model.id,
          kind: model.kind,
          ...(await LocalModels.test(model.id)),
        });
      await refresh();
    } catch (e) {
      setError(e.message);
      await refresh().catch(() => {});
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-zinc-950 light:bg-slate-50 flex">
      <Sidebar />
      <main className="relative w-full overflow-y-auto bg-zinc-900 light:bg-white text-white light:text-slate-900 m-0 md:m-4 md:rounded-2xl px-5 py-20 md:p-8">
        <div className="max-w-3xl flex flex-col gap-5">
          <h1 className="text-xl font-bold">{t("localModels:title")}</h1>
          <p className="text-sm opacity-70">{t("localModels:description")}</p>
          <p className="text-sm opacity-70">{t("localModels:format")}</p>
          <nav className="flex gap-5 text-sm underline">
            <a href={paths.settings.embedder.modelPreference()}>
              {t("localModels:embeddingLink")}
            </a>
            <a href={paths.settings.reranking()}>
              {t("localModels:rerankLink")}
            </a>
          </nav>
          <form
            ref={formRef}
            onSubmit={(e) => {
              e.preventDefault();
              perform("import");
            }}
          >
            <fieldset
              disabled={!!busy}
              className="flex flex-col gap-4 border border-white/20 light:border-slate-300 rounded-lg p-4"
            >
              <Field label={t("localModels:folder")}>
                <input
                  name="folder"
                  type="file"
                  webkitdirectory=""
                  multiple
                  required
                  onChange={(e) => {
                    const selected = Array.from(e.target.files);
                    setFiles(selected);
                    if (!name)
                      setName(
                        selected[0]?.webkitRelativePath.split("/")[0] || ""
                      );
                  }}
                />
              </Field>
              {!!files.length && (
                <p className="text-sm">
                  {t("localModels:selectedFiles", {
                    count: files.length,
                    size: (
                      files.reduce((n, f) => n + f.size, 0) /
                      1024 ** 2
                    ).toFixed(1),
                  })}
                </p>
              )}
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label={t("localModels:name")}>
                  <input
                    name="name"
                    className={inputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                    required
                  />
                </Field>
                <Field label={t("localModels:kind")}>
                  <select
                    name="kind"
                    className={inputClass}
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="embedding">
                      {t("localModels:embedding")}
                    </option>
                    <option value="reranker">
                      {t("localModels:reranker")}
                    </option>
                  </select>
                </Field>
              </div>
              <div
                className={
                  kind === "embedding" ? "flex flex-col gap-4" : "hidden"
                }
              >
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label={t("localModels:pooling")}>
                    <select
                      name="pooling"
                      className={inputClass}
                      defaultValue="mean"
                    >
                      <option value="mean">mean</option>
                      <option value="cls">cls</option>
                    </select>
                  </Field>
                  <Field label={t("localModels:maxLength")}>
                    <input
                      name="maxChunkLength"
                      className={inputClass}
                      type="number"
                      defaultValue={1000}
                      min={1}
                      max={100000}
                      required
                    />
                  </Field>
                  <Field label={t("localModels:queryPrefix")}>
                    <input
                      name="queryPrefix"
                      className={inputClass}
                      maxLength={2000}
                      placeholder="query: "
                    />
                  </Field>
                  <Field label={t("localModels:chunkPrefix")}>
                    <input
                      name="chunkPrefix"
                      className={inputClass}
                      maxLength={2000}
                      placeholder="passage: "
                    />
                  </Field>
                </div>
                <label className="flex gap-2 text-sm">
                  <input name="normalize" type="checkbox" defaultChecked />
                  {t("localModels:normalize")}
                </label>
                <p className="text-sm opacity-70">
                  {t("localModels:optionsHint")}
                </p>
              </div>
              <button
                type="submit"
                className={buttonClass}
                disabled={!files.length}
              >
                {busy === "import"
                  ? progress === 100
                    ? t("localModels:processing")
                    : t("localModels:importing", { progress })
                  : t("localModels:import")}
              </button>
            </fieldset>
          </form>
          {error && (
            <p role="alert" className="text-red-400">
              {error}
            </p>
          )}
          <p className="text-sm opacity-70">{t("localModels:testHint")}</p>
          <p className="text-sm opacity-70">{t("localModels:deleteHint")}</p>
          <p className="text-sm opacity-70">
            {t("localModels:embeddingWarning")}
          </p>
          <button
            type="button"
            className={buttonClass}
            disabled={!!busy}
            onClick={() => refresh().catch((e) => setError(e.message))}
          >
            {t("localModels:refresh")}
          </button>
          {!models && <p>{t("localModels:loading")}</p>}
          {models?.length === 0 && <p>{t("localModels:empty")}</p>}
          {models?.map((model) => (
            <section
              key={model.id}
              className="rounded-lg border border-white/20 light:border-slate-300 p-4 flex flex-col gap-3"
            >
              <h2 className="font-semibold">{model.name}</h2>
              <p className="text-sm">
                {t(`localModels:${model.kind}`)} ·{" "}
                {(model.sizeBytes / 1024 ** 2).toFixed(1)} MB ·{" "}
                {t(`localModels:${model.status}`)}
              </p>
              <p className="text-xs opacity-70">{model.id}</p>
              {(model.selected || model.loaded) && (
                <p className="text-sm">
                  {[
                    model.selected && t("localModels:selected"),
                    model.loaded && t("localModels:loaded"),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={!!busy}
                  onClick={() => perform("test", model)}
                >
                  {busy === model.id
                    ? t("localModels:testing")
                    : t("localModels:test")}
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={!!busy || model.selected || model.loaded}
                  onClick={() => perform("delete", model)}
                >
                  {t("localModels:delete")}
                </button>
              </div>
              {result?.id === model.id && (
                <p role="status" className="text-sm">
                  {t(
                    `localModels:${result.kind === "embedding" ? "embeddingResult" : "rerankResult"}`,
                    {
                      dimensions: result.dimensions,
                      ms: result.elapsedMs,
                      ranking: result.ranking
                        ?.map((r) => `${r.index}: ${r.score.toFixed(4)}`)
                        .join(", "),
                    }
                  )}
                </p>
              )}
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
