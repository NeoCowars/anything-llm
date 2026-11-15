const {
  documentHtmlToMarkdown,
} = require("../../../processLink/helpers/htmlToMarkdown");

test("local-document conversion retains outside paragraphs and citations", () => {
  const result = documentHtmlToMarkdown(
    '<p>文档开头</p><article><h1>标题</h1><p>正文<sup class="reference">[1]</sup></p></article><div class="references">参考文献</div><p>文档结尾</p>'
  );
  for (const content of [
    "文档开头",
    "# 标题",
    "正文",
    "\\[1\\]",
    "参考文献",
    "文档结尾",
  ])
    expect(result).toContain(content);
});

test("local tables retain column positions, captions, multiline cells and merge slots", () => {
  const result = documentHtmlToMarkdown(
    '<h2>预算</h2><table><caption>表1 费用</caption><tr><th>部门</th><th>项目</th><th>金额</th></tr><tr><td rowspan="2">研发</td><td>A<br>B</td><td>100</td></tr><tr><td>C</td><td>200</td></tr></table>'
  );
  expect(result).toContain("## 预算");
  expect(result).toContain("表1 费用");
  expect(result).toContain("| 部门 | 项目 | 金额 |");
  expect(result).toContain("| 研发 | A<br>B | 100 |");
  expect(result).toContain("| | C | 200 |");
});

test("embedded images produce a visible placeholder without binary data", () => {
  const result = documentHtmlToMarkdown(
    '<p>正文</p><img src="data:image/png;base64,AAAA" alt="扫描页"/><script>evil()</script>'
  );
  expect(result).toContain("扫描页");
  expect(result).not.toContain("base64");
  expect(result).not.toContain("evil()");
});
