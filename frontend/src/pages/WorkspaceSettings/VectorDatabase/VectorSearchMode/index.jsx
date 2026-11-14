import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SavedIndicator } from "@/components/AutosaveForm";

const supportedVectorDBs = ["lancedb", "chroma", "milvus"];

export default function VectorSearchMode({ workspace }) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState(
    workspace?.vectorSearchMode ?? "default"
  );
  if (!workspace?.vectorDB || !supportedVectorDBs.includes(workspace?.vectorDB))
    return null;

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-y-[8px]">
        <label htmlFor="name" className="block input-label">
          {t("reranking:workspaceTitle")}
          <SavedIndicator name="vectorSearchMode" />
        </label>
        <p className="text-white text-opacity-60 text-xs font-medium">
          {t(
            selection === "rerank"
              ? "reranking:enabledHint"
              : "reranking:disabledHint"
          )}
        </p>
      </div>
      <select
        name="vectorSearchMode"
        value={selection}
        className="border-none bg-theme-settings-input-bg text-white text-sm mt-2 rounded-lg focus:outline-primary-button active:outline-primary-button outline-none block w-full p-2.5"
        onChange={(e) => setSelection(e.target.value)}
        required={true}
      >
        <option value="default">{t("reranking:disabled")}</option>
        <option value="rerank">{t("reranking:enabled")}</option>
      </select>
    </div>
  );
}
