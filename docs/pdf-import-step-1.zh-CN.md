# 第一步：修复混合 PDF 的扫描页漏导入

本文记录最初的单项修复。后续按大类扩展的当前行为见 [导入完整性](./ingestion-integrity.zh-CN.md)。

本次只修改 PDF 按页 OCR 的触发与合并流程。

## 行为变化

- 以前：只有整份 PDF 都提取不到文本时才执行 OCR，混合 PDF 中的扫描页可能被跳过。
- 现在：保留每一页的位置，只对无文本页（包括仅空白字符的页面）执行 OCR，然后按原始页码合并。
- 原生文字页保留提取结果，不重复 OCR，也不被 OCR 结果覆盖。
- 空白页或 OCR 后仍无文本的页面会产生日志提示；这两种情况目前无法自动区分。
- OCR 运行时异常时保留已提取的原生文字，并记录警告；整份无可用文字时仍返回失败。
- 保持现有整文档输出格式；此次尚未增加页码到切块的引用映射。

## 实现

- `PDFLoader` 增加 `includeEmptyPages` 选项，PDF 导入启用该选项。
- `OCRLoader.ocrPDF` 增加可选的 `pageNumbers`，使用从 1 开始的页码；不传时仍识别全部页面。
- OCR 页码去重、排序并检查范围；任务完成时清理超时计时器。

## 验证

回归覆盖：混合 PDF、纯文字 PDF、纯扫描 PDF、空白字符页、OCR 返回顺序、保留原文、空白或识别失败、页码选择、整份 OCR 兼容和现有 1-bit 图像转换。

```powershell
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand collector/__tests__/processSingleFile/asPDF.test.js collector/__tests__/processSingleFile/PDFLoader.test.js collector/__tests__/utils/OCRLoader/pages.test.js collector/__tests__/utils/OCRLoader/index.test.js
```

测试使用模拟 PDF、图像和 OCR 运行时，不下载模型。此环境缺少采集器的 PDF/Tesseract 依赖，尚未使用真实扫描件验证识别准确率。

## 本步边界

沿用现有 OCR 引擎与语言配置、PDF 内嵌图像提取方式。页面已有文字但另含扫描图像的情况，以及多图拼页、复杂表格、GBK 编码和切块优化，留待后续步骤处理。

已有文档需要重新导入并重新向量化才能获得补充的扫描页内容。
