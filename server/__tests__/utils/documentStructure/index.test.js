const {
  parseDocumentStructure,
  csvRecords,
  markdownCells,
} = require("../../../utils/documentStructure");

test("Chinese chapters, sections and nested clauses keep ancestry and exact source spans", () => {
  const text =
    "第一章 费用管理\r\n第一节 交通\r\n第十二条 员工可报销交通费。\r\n\r\n一、适用范围\r\n（一）试用员工不享受补贴。𠀀\r\n补充说明。\r\n第二章 附则\r\n第一条 本办法生效。";
  const parsed = parseDocumentStructure(text);
  const sub = parsed.blocks.find((block) => block.text.includes("试用员工"));
  expect(sub).toMatchObject({
    type: "clause",
    path: ["第一章 费用管理", "第一节 交通"],
    clause: "第十二条 > 一、 > （一）",
  });
  const last = parsed.blocks.at(-1);
  expect(last.path).toEqual(["第二章 附则"]);
  expect(last.clause).toBe("第一条");
  for (const block of parsed.blocks)
    expect(text.slice(block.start, block.end).trim()).toBe(block.text);
});

test("Markdown and English headings reset sibling ancestry", () => {
  const parsed = parseDocumentStructure(
    "# Policy\n## Travel\nArticle 1 Eligibility\nEmployees qualify.\n## Meals\nArticle 2 Limits\nLimit applies."
  );
  expect(parsed.blocks.at(-1)).toMatchObject({
    path: ["Policy", "Meals"],
    clause: "Article 2",
  });
  expect(
    parseDocumentStructure(
      "Chapter II Benefits\nSection 3 Travel\nDetails"
    ).blocks.at(-1).path
  ).toEqual(["Chapter II Benefits", "Section 3 Travel"]);
});

test("Markdown tables retain source rows, escaped pipes and code spans", () => {
  const text =
    "# 预算\n| 项目 | 说明 |\n| --- | --- |\n| A | `a|b` |\n| B | x\\|y |\n\n备注正文";
  const table = parseDocumentStructure(text).blocks.find(
    (block) => block.type === "table"
  );
  expect(table.rows).toHaveLength(2);
  expect(table.path).toEqual(["预算"]);
  expect(table.header).toBe("| 项目 | 说明 |\n| --- | --- |");
  expect(markdownCells("| A | ``a|b`` | x\\|y |")).toEqual([
    "A",
    "``a|b``",
    "x\\|y",
  ]);
});

test("fenced examples do not create headings, clauses or tables", () => {
  const parsed = parseDocumentStructure(
    "# 正文\n~~~markdown\n# 示例标题\n第一条 示例条款\n| a | b |\n| --- | --- |\n~~~\n正文结束"
  );
  expect(
    parsed.blocks.filter((block) => block.type === "heading")
  ).toHaveLength(1);
  expect(parsed.blocks.filter((block) => block.type === "table")).toHaveLength(
    0
  );
  expect(parsed.blocks.find((block) => block.type === "code").text).toContain(
    "第一条"
  );
});

test("setext headings work without consuming following text", () => {
  const parsed = parseDocumentStructure(
    "Policy\n======\nTravel\n------\nDetails."
  );
  expect(parsed.blocks.at(-1)).toMatchObject({
    text: "Details.",
    path: ["Policy", "Travel"],
  });
});

test("ordinary punctuation, dates and decimal amounts do not become clauses", () => {
  const parsed = parseDocumentStructure(
    "2026-11-15\n1.5万元为预算上限。\nThis is prose.\n该费用见第一条。"
  );
  expect(parsed.structured).toBe(false);
});

test("CSV records preserve quoted multiline cells and doubled quotes", () => {
  const text = '项目,说明\r\nA,"第一行\n第二行"\r\nB,"含""引号"""\r\n';
  const parsed = parseDocumentStructure(text, { format: "csv" });
  expect(parsed.blocks[0]).toMatchObject({
    type: "table",
    headerSource: "first-record",
    header: "项目,说明",
  });
  expect(parsed.blocks[0].rows.map((row) => row.text)).toEqual([
    'A,"第一行\n第二行"',
    'B,"含""引号"""',
  ]);
  for (const row of csvRecords(text))
    expect(text.slice(row.start, row.end)).toBe(row.text);
});

test.each(['a,b\n"unterminated,b', 'a,b\na"quote,b', 'a,b\n"closed"x,b'])(
  "malformed CSV is preserved as unstructured source: %s",
  (text) => {
    const parsed = parseDocumentStructure(text, { format: "csv" });
    expect(parsed.structured).toBe(false);
    expect(parsed.blocks[0].text).toBe(text);
  }
);

test("JSON and code formats do not infer document hierarchy", () => {
  for (const format of ["json", "code"])
    expect(
      parseDocumentStructure("# example\n第一条", { format }).structured
    ).toBe(false);
});

test("article suffixes and single-column tables retain their markers", () => {
  const parsed = parseDocumentStructure(
    "第十条之一 特别规定\n| 条件 |\n| --- |\n| 必须提交发票 |"
  );
  expect(parsed.blocks[0].clause).toBe("第十条之一");
  expect(parsed.blocks[1]).toMatchObject({
    type: "table",
    clause: "第十条之一",
  });
});
