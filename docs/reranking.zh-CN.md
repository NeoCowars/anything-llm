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

## 三种方式怎么选

| 方式 | 在哪里选择模型 | 本应用的行为 |
| --- | --- | --- |
| 内置本地模型 | 固定为 `Xenova/ms-marco-MiniLM-L-6-v2` | 在 AnythingLLM 进程内运行，首次可能下载模型；主要面向英文 |
| Cohere 格式重排 API | 在页面填写服务提供的模型名 | 向完整接口地址发送 `model/query/documents/top_n` |
| Hugging Face TEI | 在 TEI 服务部署时选择 | 向完整 `/rerank` 地址发送 `query/texts`，页面不负责下载或切换 TEI 模型 |

“支持更换模型”指可以连接运行其他重排模型的服务。它不会把任何 Hugging Face embedding 模型直接变成重排模型。例如，页面中的 `Multilingual-E5-small` 是 embedding 选项，与这里的重排模型配置相互独立。

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
RERANK_API_KEY=
RERANK_CANDIDATE_COUNT=30
RERANK_TIMEOUT_MS=15000
```

候选数可配 1～200；若工作区要求的最终数量更大，实际请求数量会随之增大。端点需要完整 HTTP(S) URL，不能在 URL 用户名/密码位置携带凭据，也不跟随重定向。应将凭据填入 API Key。

设置页不会回显已保存的 API Key，只显示是否设置。留空会保留原密钥；勾选“清除已保存的密钥”才会清除。为兼容项目现有 `.env` 存储约定，字符串不接受换行、引号、反引号和 `#`。

生产模式沿用现有 `updateENV`/`dumpENV` 保存；开发模式另同步更新 `server/.env.development` 中的重排键。部署时仍需按原项目要求持久化配置文件。配置作用于整个实例，是否启用由各工作区分别控制。

连接测试只发送页面说明中的三个固定中文片段，不发送工作区文档，也不保存配置。真实聊天启用外部服务后，会将本次问题和候选文本发送到配置的服务地址。

## 验证范围

新增测试覆盖配置校验、密钥保留与清除、管理员权限、Cohere/TEI HTTP 请求与响应、超时、错误响应、内置推理并发控制，以及三个数据库提供者的过滤、排序、回退和引用对应关系。

其中 LanceDB 集成测试使用真实临时数据库、真实检索代码和真实 HTTP 客户端，向量和重排响应为固定测试数据。Chroma/Milvus 测试使用真实提供者代码及数据库客户端替身，没有启动真实服务。浏览器检查使用真实生产构建和新设置接口，外围 API 及重排模型响应为本地模拟数据。

以上验证证明链路与接口处理符合预期，**不代表真实中文模型准确率已经验证**。上线前请用自己的文档和问题，比较启用前后的答案、引用与耗时。

2026-11-14 的验证结果：相关回归 **15 个测试套件、229 项测试通过**；改动涉及的前后端 ESLint 检查通过；Vite 生产构建通过；原有 31 种语言的翻译结构校验通过。原源码目录的 1578 个基线文件哈希保持一致。

运行相关回归测试（仓库根目录）：

```shell
node node_modules/jest/bin/jest.js --runInBand server/__tests__/utils/EmbeddingRerankers server/__tests__/endpoints/rerank.test.js server/__tests__/utils/agents/toolReranker.test.js server/__tests__/utils/vectorDbProviders server/__tests__/utils/chats server/__tests__/models/workspace.test.js
```

本次环境的全量测试还有采集器依赖缺失，以及原有 Embedded Lemonade 测试依赖 POSIX shell/权限语义造成的 Windows 失败，未将这些问题列为本功能已通过的验证。

官方协议与部署参考：[Cohere Rerank](https://docs.cohere.com/reference/rerank)、[TEI Quick Tour](https://huggingface.co/docs/text-embeddings-inference/quick_tour)、[TEI 模型支持](https://huggingface.co/docs/text-embeddings-inference/supported_models)、[TEI 镜像说明](https://github.com/huggingface/text-embeddings-inference#docker-images)。
