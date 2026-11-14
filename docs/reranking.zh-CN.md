# 文档重排：使用与验证

本改动基于 AnythingLLM 1.19.0，支持 LanceDB、Chroma、Milvus。它把“重排”做成应用中的统一步骤，向量数据库负责初选，重排模型负责重新排序。

## 先理解它做了什么

假设你问：“试用期员工可以领取交通补贴吗？”向量检索找到这些片段：

1. “正式员工每月享受交通补贴300元。”
2. “试用期员工不享受交通补贴，转正后按规定发放。”
3. “会议室预约需要提前一天提交申请。”

重排模型会分别阅读“问题 + 一个片段”，给每个候选打分，再把更相关的片段放到前面。它不生成最终答案；最终仍由聊天模型根据选出的片段回答。

现在的流程是：**问题 → 向量初选 → 过滤不合格片段 → 重排 → 截取最终片段 → 聊天模型回答**。

例如，初选片段数设为 30，工作区最终片段数设为 4，就会先请求最多 30 个候选，过滤后重排，再取前 4 个。数据库中的片段不足、相似度过低或固定文档被排除时，实际数量可能更少。初选数不会低于工作区最终片段数。

重排只能调整候选顺序，无法找回初选阶段没有找到的内容。因此中文 embedding、分块质量和相似度阈值仍然影响最终效果。本次没有加入 BM25、关键词检索或 Hybrid RAG。

## 如何启用

1. 在系统设置中打开“重排模型”（`/settings/reranking`）。多用户模式下仅管理员可访问。
2. 选择重排方式，填写对应配置，可先“测试连接”，再“保存”。测试使用当前表单，即使尚未保存也可以测试。
3. 进入需要使用重排的工作区，在“向量数据库”设置中将“文档重排”改为“启用：对候选片段重排”。
4. 保留或调整工作区的最终片段数、相似度阈值。

更换重排模型不需要重新导入文档或生成向量。更换 embedding 模型是另一项操作，仍需遵守原有的重新向量化要求。原来 LanceDB 工作区已保存的 `vectorSearchMode=rerank` 会继续生效；新配置默认使用原有内置模型。

## 重排方式怎么选

| 方式 | 在哪里选择模型 | 本应用的行为 |
| --- | --- | --- |
| 预设本地模型 | 固定为 `Xenova/ms-marco-MiniLM-L-6-v2` | 在 AnythingLLM 进程内运行，首次可能下载模型；主要面向英文 |
| 本地模型库中的 reranker | 导入后在页面下拉选择 | 在 AnythingLLM 进程内加载 ONNX 模型；推理无需联网 |
| OpenAI 兼容服务的 `/rerank` 扩展 | 填写服务提供的重排模型名 | 发送 `model/query/documents/top_n`；这是扩展协议，不是 OpenAI 标准接口 |
| OpenAI 兼容聊天 API | 填写聊天模型名 | 通过 `/chat/completions` JSON 模式请聊天模型评分，模型需支持 JSON 模式 |
| Cohere 格式重排 API | 在页面填写服务提供的模型名 | 向完整接口地址发送 `model/query/documents/top_n` |
| Hugging Face TEI | 在 TEI 服务部署时选择 | 向完整 `/rerank` 地址发送 `query/texts`，页面不负责下载或切换 TEI 模型 |

可以导入本地 ONNX 模型，也可以连接模型服务。Embedding 模型不能直接充当 reranker。例如 `Multilingual-E5-small` 用于生成向量，与重排模型的选择相互独立。

## 本地模型的导入、测试与管理

这里的“本地”表示：**模型文件存放在服务器磁盘上，AnythingLLM 自己加载并运行模型**。浏览器只是上传和管理入口；浏览器所在电脑与服务器不同时，实际推理发生在服务器。

1. 打开系统设置 →“本地模型库”（`/settings/local-models`），选择模型文件夹。
2. 填写名称及用途：embedding 或 reranker。模型至少需要下面的文件结构，文件名区分大小写：

   ```text
   my-model/
     config.json
     tokenizer.json
     tokenizer_config.json
     onnx/
       model.onnx                 # 或 model_quantized.onnx
   ```

3. 导入 embedding 时，按模型作者说明设置 mean/cls 池化、归一化、问题/文档前缀、最大片段字符数。比如 E5 常见前缀为 `query: ` 和 `passage: `，末尾空格也要保留。字符数与 token 数不同；即使字符数没有超限，分词后仍可能触发模型的截断。
4. 点击“导入模型”。页面显示上传进度；文件校验通过后会生成固定模型 ID，模型库显示为“尚未测试推理”。
5. 点击“测试推理”。Embedding 返回输出维度；reranker 返回固定中文样例的候选编号及分数。**测试通过说明能运行，不代表模型适合你的文档。**
6. Embedding：进入“Embedding 设置”，选择原有的本地提供者 `AnythingLLM Embedder`，在模型下拉框选择刚导入的模型。Reranker：进入“重排模型设置”，选择“本地模型库中的 reranker”，再选模型并保存。

支持的是当前引擎 **Transformers.js v2 能加载的 ONNX 模型**，不是任意格式的权重。普通 PyTorch、safetensors、GGUF 文件不能在这里直接运行，也不会自动转换。Reranker 需为单分数输出的 sequence-classification 模型；仅修改配置文件不能把不兼容的模型变成兼容模型。

单次最多 128 个文件，单文件最多 2 GB、合计最多 8 GB；模型文件夹应只包含 ONNX 权重及 JSON/TXT/MODEL/DATA 等配置、分词器数据。README、Python 文件、其他格式权重请放在文件夹外。若同时存在普通与量化 ONNX 文件，优先使用量化文件。反向代理还可能有独立的上传大小与超时限制，需要随部署调整。

文件及注册信息保存在 `STORAGE_DIR/models/library`；没有设置 `STORAGE_DIR` 时使用 `server/storage/models/library`。部署时应持久化整个 storage 目录。导入会复制到模型库，原文件不受影响；导入后模型 ID 和参数保持固定。如需更改权重或参数，请重新导入成新模型。

模型库可以查看导入状态、测试、删除。已选用模型必须先切换；本进程加载过的模型还需重启服务后才能删除，避免旧推理会话继续占用内存或访问已删文件。当前运行时无法可靠卸载 ONNX 会话，因此频繁切换多个大模型后建议重启释放内存。

**更换 embedding 模型时必须重新生成已有文档向量**，否则新问题向量与旧文档向量不匹配。原有 embedding 设置页的重建提示及流程仍然生效。更换 reranker 不需要重建。

## 远端 OpenAI 兼容请求

Embedding 设置中选择 **OpenAI-compatible API**，填写服务的基础地址（例如 `http://localhost:8080/v1`）、模型名、可选密钥。应用使用 OpenAI SDK 请求 `/embeddings`，发送 `model/input/encoding_format: float`。响应中的 `data[].index` 用于对应输入顺序；应用拒绝缺失或重复编号、非数值向量、维度不一致等结果，防止文档和向量错配。

“测试 embedding 连接”使用当前尚未保存的表单配置发送固定样例，不会切换现用 embedding 模型，也不会重建向量。返回维度和耗时供检查。测试不执行配置中的文档/问题前缀，只检查接口；正式检索和入库仍使用各自前缀。

远端重排有两条路径：

- **专用 reranker 服务**：选择 `/rerank` 扩展并填写完整地址（如 `http://localhost:8080/v1/rerank`）。请求与下面的 Cohere 示例相同。响应支持 `results` 或 `data` 数组，每项有 `index`，分数字段为 `relevance_score` 或 `score`。仅“OpenAI 兼容”这个名称不能保证服务实现了此扩展，请先测试。
- **聊天模型评分**：选择“OpenAI 兼容聊天 API”，填写完整 `/v1/chat/completions` 地址和聊天模型名。应用发送 `stream:false`、`response_format:{"type":"json_object"}`，把问题与带编号的候选片段作为数据，请模型返回 `{"results":[{"index":0,"score":0.5},...]}`。必须为全部候选各返回一个数值分数，否则回退到向量排序。这条路径适用于支持 JSON 模式的聊天服务，速度、稳定性与专用 reranker 可能不同。

例如，部署在本机独立服务中的模型也可以通过上述地址接入；这与“把 ONNX 文件导入 AnythingLLM 进程内运行”是两种部署方式。

### 本地中文模型示例：TEI

下面提供一个部署起点，使用 TEI 官方支持列表中的 `BAAI/bge-reranker-base`。需要先准备好 Docker 的 Linux 容器环境；下载镜像和模型需要网络、磁盘与内存。此部署命令未在本次验证中实际运行，实际模型效果也尚未评测。

```shell
docker run --name anythingllm-reranker -p 127.0.0.1:8080:80 -v anythingllm-rerank-models:/data ghcr.io/huggingface/text-embeddings-inference:cpu-1.9 --model-id BAAI/bge-reranker-base
```

等待服务加载模型完成后，若 AnythingLLM 后端直接运行在宿主机，页面选择 TEI，接口填写 `http://127.0.0.1:8080/rerank`。无鉴权的本地服务可将 API Key 留空。候选数先用 30，超时可根据硬件调整，允许范围为 100～120000 毫秒。

**地址必须能被 AnythingLLM 后端访问。** 如果 AnythingLLM 也在 Docker 中，容器里的 `localhost` 指向该容器。此时需按容器网络配置可达的服务地址，例如共享 Docker 网络中的 `http://reranker:80/rerank`。上面的宿主机端口发布示例并未创建共享网络。

TEI 更换模型需要重新部署 TEI，然后再次测试连接。也可以连接已有的中文重排服务，只要接口符合下面的协议。

### Cohere 格式示例

填写完整地址，例如 Cohere 服务的 `https://api.cohere.com/v2/rerank`，以及该服务实际提供的模型名和密钥。自部署的兼容服务可能提供 `BAAI/bge-reranker-v2-m3` 等模型名，**是否可用由该服务决定**；填写模型名不会在 AnythingLLM 中自动安装模型。

## 接口约定

以下是应用实际发送的结构。候选片段只发送文本，认证使用可选的 `Authorization: Bearer ...`。

**Cohere 格式：**

```json
{
  "model": "your-service-model-name",
  "query": "试用期员工可以领取交通补贴吗？",
  "documents": ["正式员工有交通补贴。", "试用期员工没有交通补贴。"],
  "top_n": 2
}
```

响应示例：

```json
{"results":[{"index":1,"relevance_score":0.95},{"index":0,"relevance_score":0.4}]}
```

**TEI 格式：**

```json
{
  "query": "试用期员工可以领取交通补贴吗？",
  "texts": ["正式员工有交通补贴。", "试用期员工没有交通补贴。"],
  "truncate": true,
  "raw_scores": false,
  "return_text": false
}
```

响应示例：

```json
[{"index":1,"score":0.95},{"index":0,"score":0.4}]
```

`index` 是候选原始位置，从 0 开始。服务必须为每个候选返回且仅返回一次分数；重复、缺失、越界索引和非数值分数会被拒绝。应用按分数降序排列，再取工作区要求的最终数量。长文本截断遵循所选模型/服务的限制；TEI 请求显式启用截断。

分数 0 是合法结果。分数用于排序，不能解释为答案正确率；不同模型的分数也不宜直接横向比较。

## 两个原有问题怎样处理

**先截取再过滤会少拿片段。** 假设要 2 条，重排前两名是 A、B，但 A 是已固定加入上下文的文档。旧路径先取 A、B 再删 A，最后只剩 B，即使第 3 名 C 合格也不补进来。现在先过滤 A，再对 B、C 等合格候选排序，最后取 2 条。相关实现：[`search.js`](../server/utils/EmbeddingRerankers/search.js)，以及各数据库的 `similarityResponse`。

**重排失败不再清空检索结果。** 模型服务超时、不可用或返回错误数据时，应用保留已检索到的合格候选，按原向量顺序取最终数量，并记录降级日志。它不会把服务故障当成“没有找到文档”。数据库本身失败或确实没有合格候选，仍然遵循原有行为。

内置推理无法中断，超过等待时间后可能在后台继续。完成前的新内置重排请求会直接回退，避免同时叠加多次推理；HTTP 服务请求则会在超时后中止。默认等待时间为 15 秒，首次下载模型可能超过这个时间。

片段和引用一起重排，防止答案内容与来源错位。返回的来源保留原 `score`，并在重排成功时增加 `retrievalScore` 和 `rerankScore`；已有消费者仍可读取原字段。共享检索层返回 `rerank.status=applied/fallback`，部分上层聊天接口只保留来源字段，降级仍可通过服务器日志观察。

## 环境变量与保存

```dotenv
RERANK_PROVIDER=native
RERANK_ENDPOINT=
RERANK_MODEL=
RERANK_LOCAL_MODEL=
RERANK_API_KEY=
RERANK_CANDIDATE_COUNT=30
RERANK_TIMEOUT_MS=15000
```

候选数可配 1～200；若工作区要求的最终数量更大，实际请求数量会随之增大。端点需要完整 HTTP(S) URL，不能在 URL 用户名/密码位置携带凭据，也不跟随重定向。应将凭据填入 API Key。

设置页不会回显已保存的 API Key，只显示是否设置。留空会保留原密钥；勾选“清除已保存的密钥”才会清除。为兼容项目现有 `.env` 存储约定，字符串不接受换行、引号、反引号和 `#`。

生产模式沿用现有 `updateENV`/`dumpENV` 保存；开发模式另同步更新 `server/.env.development` 中的重排键。部署时仍需按原项目要求持久化配置文件。配置作用于整个实例，是否启用由各工作区分别控制。

连接测试只发送页面说明中的三个固定中文片段，不发送工作区文档，也不保存配置。真实聊天启用外部服务后，会将本次问题和候选文本发送到配置的服务地址。

## 验证范围

新增测试覆盖配置校验、密钥保留与清除、管理员权限、Cohere/TEI/OpenAI 兼容 HTTP 请求与响应、超时、错误响应、内置推理并发控制，以及三个数据库提供者的过滤、排序、回退和引用对应关系。模型库测试覆盖真实 multipart 导入、路径校验、状态持久化、用途匹配、删除保护；OpenAI SDK 测试覆盖无密钥请求、浮点输出、向量乱序还原及损坏响应拒绝。

另外使用两个极小的**合成 ONNX 模型**，在禁用网络的子进程内真实运行 Transformers.js：完成导入 → embedding/问题向量 → reranker 单分数推理 → 会话缓存/删除保护。测试包含 Windows 下模型存储目录和项目位于不同磁盘的情况。合成模型只验证加载与输出合同，不具备真实语义检索能力。

其中 LanceDB 集成测试使用真实临时数据库、真实检索代码和真实 HTTP 客户端，向量和重排响应为固定测试数据。Chroma/Milvus 测试使用真实提供者代码及数据库客户端替身，没有启动真实服务。浏览器检查使用真实生产构建和新设置接口，外围 API 及重排模型响应为本地模拟数据。

以上验证证明链路与接口处理符合预期，**不代表真实中文模型准确率已经验证**。上线前请用自己的文档和问题，比较启用前后的答案、引用与耗时。

2026-11-14 的验证结果：相关回归 **18 个测试套件、264 项测试通过**；改动文件的前后端 ESLint 检查通过；Vite 生产构建通过；原有 31 种语言的翻译结构校验通过。原源码目录的 1578 个基线文件哈希保持一致。

模型库的浏览器验证使用真实上传接口和真实 ONNX 推理，模型为上述合成样例；已检查两类导入、推理、模型下拉选择、本地重排保存/测试、远端三种请求协议的测试结果与连接失败提示。远端服务采用本机模拟响应，未调用付费 API。未进行真实中文预训练模型的准确率评测。

运行相关回归测试（仓库根目录）：

```shell
node node_modules/jest/bin/jest.js --runInBand server/__tests__/utils/EmbeddingRerankers server/__tests__/endpoints/rerank.test.js server/__tests__/endpoints/localModels.test.js server/__tests__/utils/localModelLibrary.test.js server/__tests__/utils/genericOpenAiEmbedding.test.js server/__tests__/utils/agents/toolReranker.test.js server/__tests__/utils/vectorDbProviders server/__tests__/utils/chats server/__tests__/models/workspace.test.js
```

本次环境的全量测试还有采集器依赖缺失，以及原有 Embedded Lemonade 测试依赖 POSIX shell/权限语义造成的 Windows 失败，未将这些问题列为本功能已通过的验证。

官方协议与部署参考：[Cohere Rerank](https://docs.cohere.com/reference/rerank)、[TEI Quick Tour](https://huggingface.co/docs/text-embeddings-inference/quick_tour)、[TEI 模型支持](https://huggingface.co/docs/text-embeddings-inference/supported_models)、[TEI 镜像说明](https://github.com/huggingface/text-embeddings-inference#docker-images)。

OpenAI Docs：[Embeddings 请求与输出](https://developers.openai.com/api/reference/resources/embeddings/methods/create)、[Chat Completions 与 JSON 模式](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。`/rerank` 扩展的合同由本应用定义，不能从 OpenAI 标准接口兼容性推导出该扩展也可用。
