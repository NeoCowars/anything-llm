export default {
  en: {
    title: "Local model library",
    description:
      "Import a model folder to run embedding or reranking on this AnythingLLM server. No external inference service is needed.",
    format:
      "Supports Transformers.js v2 ONNX models: config.json, tokenizer.json, tokenizer_config.json and onnx/model.onnx (or model_quantized.onnx). PyTorch, safetensors and GGUF weights cannot be loaded here. Up to 128 files, 2 GB per file, 8 GB total; your reverse proxy may impose smaller limits.",
    folder: "Model folder",
    name: "Display name",
    kind: "Model task",
    embedding: "Embedding",
    reranker: "Reranker",
    pooling: "Pooling",
    normalize: "Normalize vectors",
    maxLength: "Maximum chunk length (characters)",
    queryPrefix: "Query prefix",
    chunkPrefix: "Passage prefix",
    optionsHint:
      "Use the model author's pooling, normalization, prefixes and input length recommendations. For E5, these are often query: and passage: (including the trailing space). Character limits are not token limits.",
    import: "Import model",
    importing: "Uploading {{progress}}%…",
    processing: "Validating and importing…",
    imported: "Model imported. Run an inference test before selecting it.",
    selectedFiles: "{{count}} files · {{size}} MB",
    empty: "No imported models yet.",
    loading: "Loading…",
    refresh: "Refresh",
    test: "Test inference",
    testing: "Running…",
    delete: "Delete",
    confirmDelete: "Delete {{name}} and its model files?",
    selected: "Currently selected",
    loaded: "Loaded in memory",
    deleteHint:
      "To delete a selected model, choose another model first. For a loaded model, also restart the server to release its session.",
    "files-validated": "Files validated; inference not tested",
    "inference-tested": "Inference passed",
    "test-failed": "Inference failed",
    testHint:
      "The test uses fixed Chinese sample text. Passing confirms that inference runs, not that retrieval quality is good. Initial loading can take time.",
    embeddingResult: "Inference passed: {{dimensions}} dimensions, {{ms}} ms",
    rerankResult:
      "Inference passed: {{ms}} ms; candidate indices and scores: {{ranking}}",
    embeddingLink: "Embedding settings",
    rerankLink: "Reranking settings",
    manage: "Import and manage local models",
    embeddingWarning:
      "Changing the embedding model requires re-embedding existing documents. Changing the reranker does not.",
    remoteHint:
      "OpenAI-compatible embedding API: enter a base URL such as http://localhost:8080/v1. Requests are sent to /embeddings. An API key is optional for local services.",
    testRemote: "Test embedding connection",
    remoteResult:
      "Connected: {{dimensions}} dimensions, {{ms}} ms. Settings have not been saved.",
    remoteTestHint:
      "Sends fixed sample text using the URL, model and key currently entered in this form; does not change your active embedding model.",
  },
  zh: {
    title: "本地模型库",
    description:
      "导入模型文件夹后，在 AnythingLLM 所在服务器上运行 embedding 或重排，无需另起推理服务。",
    format:
      "支持 Transformers.js v2 可加载的 ONNX 模型：config.json、tokenizer.json、tokenizer_config.json，以及 onnx/model.onnx（或 model_quantized.onnx）。这里不能直接加载 PyTorch、safetensors 或 GGUF 权重。最多 128 个文件，单文件 2 GB、合计 8 GB；反向代理可能另有限制。",
    folder: "模型文件夹",
    name: "显示名称",
    kind: "模型用途",
    embedding: "Embedding（文本向量）",
    reranker: "Reranker（片段重排）",
    pooling: "向量池化方式",
    normalize: "归一化向量",
    maxLength: "最大片段长度（字符）",
    queryPrefix: "问题前缀",
    chunkPrefix: "文档前缀",
    optionsHint:
      "请按模型作者说明填写池化、归一化、前缀和输入长度。E5 常见前缀为 query: 和 passage:，冒号后含空格。字符数不等于 token 数。",
    import: "导入模型",
    importing: "正在上传 {{progress}}%…",
    processing: "正在校验并入库…",
    imported: "模型已导入，请先测试推理，再选择使用。",
    selectedFiles: "{{count}} 个文件 · {{size}} MB",
    empty: "还没有导入模型。",
    loading: "加载中…",
    refresh: "刷新",
    test: "测试推理",
    testing: "运行中…",
    delete: "删除",
    confirmDelete: "确定删除 {{name}} 及其模型文件吗？",
    selected: "当前已选用",
    loaded: "已加载到内存",
    deleteHint:
      "删除已选用模型前，请先切换为其他模型。已加载模型还需重启服务，释放推理会话后再删除。",
    "files-validated": "文件校验通过，尚未测试推理",
    "inference-tested": "推理测试通过",
    "test-failed": "推理测试失败",
    testHint:
      "测试使用固定中文样例。通过仅表示模型能运行，不代表检索效果好。首次加载可能需要一些时间。",
    embeddingResult: "推理通过：{{dimensions}} 维，耗时 {{ms}} 毫秒",
    rerankResult: "推理通过：耗时 {{ms}} 毫秒；候选编号及分数：{{ranking}}",
    embeddingLink: "Embedding 设置",
    rerankLink: "重排模型设置",
    manage: "导入和管理本地模型",
    embeddingWarning:
      "更换 embedding 模型需要重新生成已有文档向量；更换 reranker 不需要。",
    remoteHint:
      "OpenAI 兼容 embedding API：填写基础地址，例如 http://localhost:8080/v1。请求会发往 /embeddings；无鉴权的本地服务可不填 API Key。",
    testRemote: "测试 embedding 连接",
    remoteResult:
      "连接成功：{{dimensions}} 维，耗时 {{ms}} 毫秒。尚未保存设置。",
    remoteTestHint:
      "使用表单里当前填写的地址、模型和密钥发送固定样例，不会更改正在使用的 embedding 模型。",
  },
};
