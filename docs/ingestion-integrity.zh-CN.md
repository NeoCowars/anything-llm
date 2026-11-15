# 第一大类：导入完整性

适用代码库：`anythingllm-1.19.0-rerank`。本类在混合 PDF 按页 OCR 修复的基础上，补齐文本编码、PDF 部分失败处理和导入诊断。

## 具体变化

| 环节 | 原有问题 | 当前行为 |
| --- | --- | --- |
| 文本类文件 | 非 UTF-8 中文可能被按西文编码读取 | 优先严格读取 UTF-8、带 BOM 的 UTF-16；自动推断 GB18030 或 Windows-1252 时发出警告，也可明确指定编码 |
| 混合 PDF | 整份已有文字时，扫描页可能被跳过 | 只对无文字页执行 OCR，按原始页序合并，保留原生文字 |
| PDF 单页异常 | 一页提取或 OCR 失败可能影响其他页 | 原生文字提取逐页隔离错误；OCR 单页失败后继续其他页 |
| OCR 超时 | 当前批次已完成的页面可能丢失 | 保留已完成页；未完成页记录超时，迟到的识别结果不再修改已返回内容 |
| OCR 默认语言 | 默认仅英文 | 未配置时使用简体中文加英文；已有明确配置仍优先 |
| 导入反馈 | 部分内容缺失仍可能只显示成功 | 返回完整、部分、失败状态和独立报告；工作区上传有警告时显示持续的黄色提示，可手动关闭 |
| 报告生命周期 | 无独立逐页诊断 | 报告单独落盘；删除文档或文档文件夹时清理关联报告 |

文本处理覆盖路由到 `asTxt` 的类型，包括 TXT、Markdown、CSV、JSON、HTML 等。CSV 仍按文本导入，HTML 仍按原有方式作为文本处理；这里没有新增表格或网页结构解析。

## 状态与报告

文档及导入响应增加以下标量字段：

- `ingestionStatus`：`complete`、`partial`、`failed`。
- `ingestionWarning`：简短警告，最长 2000 个 JavaScript 字符单元。
- `ingestionReportId`：64 位小写十六进制报告 ID。
- `sourceEncoding`：文本类文档使用的编码。

`complete` 仅表示本流程提取到了可用文本：PDF 的每页均有文字，或文本类文件解码后非空。它不保证识别准确、不漏同页图像、不丢版面或表格结构。

PDF 存在无可用文字的页面、同时其他页有文字时，状态为 `partial`；全部无可用文字或文档无法打开时为 `failed`。真正空白页与无法识别页仍保守地记录为未解决，不会自动断言是空白页。

完整报告保存到：

- 开发环境：`server/storage/ingestion-reports/<id>.json`。
- 生产环境：`${STORAGE_DIR}/ingestion-reports/<id>.json`，采集器和服务端须使用同一存储目录。

报告含源文件名、创建时间、状态、警告、编码检测方式，以及 PDF 原始页码、原生提取或 OCR、识别状态和错误。页码从 1 开始；文字页还记录在最终 `pageContent` 中的 `[start, end)` 区间，单位为 `utf16-code-units`，可用 JavaScript `slice(start, end)` 还原该页文本。它尚未映射到向量切块或聊天引用。

逐页列表不会复制进每个向量切块；文档元数据只保留摘要与报告 ID。已有 DOCX、XLSX、图片等其他转换器仍使用原有输出，尚未统一增加该报告。

已认证的管理员或经理可调用：

```http
POST /api/document/ingestion-report
Content-Type: application/json

{"docpath":"custom-documents/example.json"}
```

也可提交 `{"reportId":"<64 位报告 ID>"}`，查询未生成文档的失败导入。响应为 `{"success":true,"report":{...}}`；输入不合法返回 400，报告不存在返回 404。该路由沿用应用会话认证，并非新增开发者 API 密钥路由。

失败导入和临时直接上传的报告会保留用于诊断，目前没有自动过期清理。报告只保存诊断及偏移，不保存原始 PDF 或完整识别文字。

## 编码控制

自动模式按以下顺序选择：UTF-16 BOM、严格 UTF-8、合法且包含汉字的 GB18030、Windows-1252。旧编码字节可能存在歧义；自动推断会返回 `TEXT_ENCODING_INFERRED`，需要核对内容。

上传元数据可明确指定：

```json
{"textEncoding":"gb18030"}
```

支持 `auto`、`utf-8` / `utf8`、`utf-16le`、`utf-16be`、`gbk`、`gb2312`、`gb18030`、`windows-1252`。GBK、GB2312 使用 GB18030 解码器兼容读取。内部解析调用也支持 `options.textEncoding`，优先于元数据。普通上传界面尚未增加编码选择控件。

明确指定的编码解码失败、结果含 NUL、结果为空或仅含空白时，返回失败报告；原文件已包含替换字符时发出警告。无 BOM 的 UTF-16 应明确指定编码。Big5 等编码不在本类支持范围内。

## OCR 配置与运行边界

服务端未配置 `TARGET_OCR_LANG` 时，默认传递 `chi_sim,eng`。如需繁体中文，可明确设置 `chi_sim,chi_tra,eng`。原来已配置 `eng` 的环境仍按英文执行，需要自行修改配置才能启用中文。

新增中文默认值可能让首次 OCR 需要取得对应语言数据；本次没有下载模型、安装依赖或重启服务。离线环境应预先准备对应数据，并核验缓存目录和资源开销。

PDF OCR 沿用现有内嵌图像提取器：每页取首个可用图像，沿用现有约 70 DPI 的缩放参数，并非整页高分辨率渲染。以下情况仍有局限：

- 同一页既有原生文字又有扫描图像：目前有原生文字就不会触发该页 OCR。
- 多图拼页、分栏、旋转、图像蒙版、细小中文、复杂表格和公式。
- 原生文字层虽非空但乱码、缺字或阅读顺序错误。
- 长文档仍整份读入并合并，尚无流式解析、断点恢复或超大文件内存治理。
- PDF OCR 的执行期限覆盖图像处理器初始化、工作线程初始化和识别；文件读取、PDF 打开、元数据读取及资源清理不在该期限内。
- 独立图片 OCR 的既有执行流程未在本类重写，只继承了语言默认值变化。

## 验证与生效

回归覆盖严格编码与旧编码、转换器输出、混合 PDF、中文与补充平面字符偏移、单页异常、OCR 部分超时和迟到结果、工作线程清理、报告读写与删除、接口鉴权注册、上传警告与失败报告 ID 传递。PDF 和 Tesseract 运行时使用模拟依赖；尚未测量真实扫描件的识别准确率。

前端通过生产构建及翻译结构校验；未做浏览器视觉验收。默认根 ESLint 存在既有 React 插件兼容问题，使用针对改动文件的独立规则检查，不代表整个仓库默认 lint 通过。

本次验证结果：14 组、140 项 Jest 测试通过；26 个 Node 文件及 3 个前端文件的独立静态检查通过；`git diff --check` 通过。可复现的回归命令：

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand collector/__tests__/processSingleFile collector/__tests__/utils/textEncoding.test.js collector/__tests__/utils/ingestion.test.js collector/__tests__/utils/OCRLoader server/__tests__/endpoints/ingestionReport.test.js server/__tests__/endpoints/ingestionUpload.test.js server/__tests__/utils/files
```

应用改动后需重新启动采集器和服务端，并使用新的前端构建。已有文档需重新导入和重新向量化，才能补上此前遗漏的文字；单独重新向量化旧的解析结果不会重新执行 OCR。

后续按大类推进：结构化解析与 OCR 质量、长文档与中英文切块、复杂表格结构及精确查询。语义切块、Agent 切块、GraphRAG 和关系存储均未在本类引入；它们不能补回导入阶段未提取到的原文。

后续结构解析与结构感知切块的实现见 [第二大类说明](./document-structure.zh-CN.md)。本文的格式覆盖范围记录第一大类完成时的状态。
