export default {
  en: {
    title: "Reranking",
    description:
      "Choose the model used to reorder retrieved document passages. Changing this setting does not re-embed your documents.",
    workspaceHint:
      "Enable reranking in each workspace under Vector Database. Supported: LanceDB, Chroma and Milvus.",
    provider: "Reranking provider",
    native: "Built-in local model",
    cohere: "Cohere-compatible rerank API",
    tei: "Hugging Face TEI",
    model: "Model name",
    endpoint: "Full rerank endpoint URL",
    apiKey: "API key (optional)",
    keyStored: "A key is stored. Leave blank to keep it.",
    clearKey: "Clear the stored API key",
    optional: "Optional",
    nativeHint:
      "The built-in model is intended for English. For Chinese, configure a service hosting a multilingual reranker. First use may download the built-in model.",
    teiHint:
      "TEI uses the model deployed on its server. Change the model in the TEI deployment.",
    candidates: "Candidate passages (1–200)",
    timeout: "Timeout (milliseconds)",
    candidatesHint:
      "Retrieve this many candidates before reranking. The final passage count is set in each workspace. At least that many candidates are requested.",
    fallbackHint:
      "If reranking fails or times out, retrieval falls back to vector ranking. Native inference already in progress may finish in the background.",
    testHint:
      "Connection test sends three fixed Chinese sample passages to the selected service. It does not save settings or send workspace documents.",
    save: "Save",
    saving: "Saving…",
    saved: "Reranking settings saved.",
    test: "Test connection",
    testing: "Testing…",
    failed: "Request failed.",
    loadFailed: "Could not load settings. Reload this page to try again.",
    loading: "Loading…",
    testResult: "Test completed in {{ms}} ms",
    score: "Relevance score",
    scoreHint:
      "Scores are ranking signals, not probabilities that an answer is correct. This sample does not measure overall Chinese retrieval quality.",
    embeddingLink: "Embedding settings",
    workspaceTitle: "Document reranking",
    enabled: "Enabled — rerank candidates",
    disabled: "Disabled — vector retrieval",
    enabledHint:
      "Use the model selected in System Settings → Reranking to reorder candidates before choosing the final passages.",
    disabledHint:
      "Use vector similarity to select passages. Enable reranking to compare each candidate with your question.",
  },
  zh: {
    title: "重排模型",
    description:
      "配置对检索到的文档片段重新排序所用的模型。更换重排模型无需重新生成文档向量。",
    workspaceHint:
      "请在各工作区的“向量数据库”页面启用重排。支持 LanceDB、Chroma 和 Milvus。",
    provider: "重排方式",
    native: "内置本地模型",
    cohere: "Cohere 格式重排 API",
    tei: "Hugging Face TEI",
    model: "模型名称",
    endpoint: "完整重排接口地址",
    apiKey: "API Key（可选）",
    keyStored: "已保存密钥，留空表示保留。",
    clearKey: "清除已保存的密钥",
    optional: "可选",
    nativeHint:
      "内置模型面向英文。中文场景请连接部署了多语言重排模型的服务。内置模型首次使用可能需要下载。",
    teiHint: "TEI 使用服务端部署的模型；更换模型需要调整 TEI 部署配置。",
    candidates: "初选片段数（1～200）",
    timeout: "超时时间（毫秒）",
    candidatesHint:
      "先检索这些候选再重排，最终片段数在各工作区设置。实际请求的候选数至少覆盖最终片段数。",
    fallbackHint:
      "重排失败或超时后，将退回向量检索排序。已开始的内置模型推理可能在后台完成。",
    testHint:
      "连接测试会向所选服务发送三个固定的中文示例片段，不保存设置，也不发送工作区文档。",
    save: "保存",
    saving: "保存中…",
    saved: "重排设置已保存。",
    test: "测试连接",
    testing: "测试中…",
    failed: "请求失败。",
    loadFailed: "无法读取设置，请刷新页面重试。",
    loading: "加载中…",
    testResult: "测试完成，耗时 {{ms}} 毫秒",
    score: "相关性分数",
    scoreHint:
      "分数用于排序，不代表答案正确的概率。此示例不能衡量整体中文检索质量。",
    embeddingLink: "Embedding 设置",
    workspaceTitle: "文档重排",
    enabled: "启用：对候选片段重排",
    disabled: "关闭：按向量检索排序",
    enabledHint:
      "使用“系统设置 → 重排模型”中配置的模型，对候选重新排序后选取最终片段。",
    disabledHint:
      "按向量相似度选取片段；开启重排后会进一步比较问题与各个候选片段。",
  },
};
