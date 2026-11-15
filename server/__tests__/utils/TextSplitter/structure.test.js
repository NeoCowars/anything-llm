const { TextSplitter } = require("../../../utils/TextSplitter");
beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());
const splitter = (config = {}) =>
  new TextSplitter({ chunkSize: 240, chunkOverlap: 15, ...config });

test("small clauses remain intact and do not mix conflicting sibling clauses", async () => {
  const text =
    "第一章 交通补贴\n第一条 正式员工每月交通补贴300元。\n第二条 试用期员工不享受交通补贴。";
  const chunks = await splitter().splitText(text);
  const probation = chunks.find((chunk) => chunk.includes("不享受"));
  expect(probation).toContain("第一章 交通补贴");
  expect(probation).toContain("第二条");
  expect(probation).not.toContain("300元");
  expect(chunks.find((chunk) => chunk.includes("300元"))).toContain(
    "第一条 正式员工每月交通补贴300元。"
  );
});

test("long Chinese clauses carry chapter and article context within the configured body limit", async () => {
  const text =
    "第一章 费用\n第十二条 " +
    "员工报销须提供发票。".repeat(100) +
    "最后一句应保留。";
  const chunks = await splitter().splitText(text);
  expect(chunks.length).toBeGreaterThan(3);
  expect(chunks.every((chunk) => chunk.length <= 240)).toBe(true);
  expect(
    chunks.every(
      (chunk) => chunk.includes("第一章 费用") && chunk.includes("第十二条")
    )
  ).toBe(true);
  expect(chunks.at(-1)).toContain("最后一句应保留。");
});

test("every split table fragment repeats its column header and keeps each normal row intact", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => `| 部门${i} | 金额${i} |`);
  const header = "| 部门 | 补贴金额 |\n| --- | --- |";
  const chunks = await splitter({ chunkSize: 180 }).splitText(
    `# 交通费\n${header}\n${rows.join("\n")}`
  );
  const tables = chunks.filter(
    (chunk) => chunk.includes("金额0") || chunk.includes(header)
  );
  expect(tables.length).toBeGreaterThan(2);
  expect(
    tables.every(
      (chunk) =>
        chunk.includes(header) &&
        chunk.includes("交通费") &&
        chunk.length <= 180
    )
  ).toBe(true);
  for (const row of rows)
    expect(tables.filter((chunk) => chunk.includes(row))).toHaveLength(1);
});

test("CSV quoted multiline records stay together and first record is repeated as context", async () => {
  const rows = Array.from(
    { length: 12 },
    (_, i) => `${i},"中文备注\n第二行${i}"`
  );
  const chunks = await splitter({
    documentFormat: "csv",
    chunkSize: 90,
  }).splitText(`编号,说明\n${rows.join("\n")}`);
  expect(
    chunks.every(
      (chunk) => chunk.startsWith("编号,说明\n") && chunk.length <= 90
    )
  ).toBe(true);
  for (const row of rows)
    expect(chunks.filter((chunk) => chunk.includes(row))).toHaveLength(1);
});

test("large headers and oversized rows preserve content without exceeding the body budget", async () => {
  const text =
    "# 测试\n| " +
    "超长列名".repeat(70) +
    " | B |\n| --- | --- |\n| FINAL | 保留全部内容 |";
  const chunks = await splitter({ chunkSize: 120, chunkOverlap: 0 }).splitText(
    text
  );
  expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true);
  expect(chunks.join("")).toContain("FINAL");
  expect(chunks.join("")).toContain("保留全部内容");
});

test("supplementary Chinese characters are never returned as lone surrogates", async () => {
  for (const overlap of [0, 7]) {
    const chunks = await splitter({
      chunkSize: 61,
      chunkOverlap: overlap,
    }).splitText("# 扩展汉字\n第九条 " + "𠀀".repeat(180));
    for (const chunk of chunks)
      expect(chunk).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u
      );
  }
});

test("existing document metadata and embedder prefixes remain present exactly once", async () => {
  const instance = splitter({
    chunkPrefix: "passage: ",
    chunkHeaderMeta: { sourceDocument: "规章.docx" },
  });
  const chunks = await instance.splitText(
    "第一章 政策\n第一条 员工可申请补贴。\n第二条 特定人员除外。"
  );
  for (const chunk of chunks) {
    expect(chunk.startsWith(instance.stringifyHeader())).toBe(true);
    expect(chunk.match(/<document_metadata>/g)).toHaveLength(1);
    expect(chunk.length).toBeLessThanOrEqual(240);
  }
});

test("structureAware=false gives the original splitter output for rollback", async () => {
  const text = "第一章 政策\n第一条 " + "员工可申请。".repeat(50);
  const instance = splitter({ structureAware: false });
  const {
    RecursiveCharacterTextSplitter,
  } = require("@langchain/textsplitters");
  expect(await instance.splitText(text)).toEqual(
    await new RecursiveCharacterTextSplitter({
      chunkSize: 240,
      chunkOverlap: 15,
    }).splitText(text)
  );
});

test("structured chunks reserve the document metadata and embedding prefix within the total budget", async () => {
  const chunks = await splitter({
    chunkSize: 180,
    chunkPrefix: "passage: ",
    chunkHeaderMeta: { sourceDocument: "中文条款.docx" },
  }).splitText("第一章 规定\n第九条 " + "完整句子。".repeat(100));
  expect(chunks.length).toBeGreaterThan(5);
  expect(
    chunks.every(
      (chunk) =>
        chunk.length <= 180 && chunk.includes("sourceDocument: 中文条款.docx")
    )
  ).toBe(true);
});

test("oversized document metadata fails clearly instead of silently exceeding the embedding budget", async () => {
  await expect(
    splitter({
      chunkHeaderMeta: { sourceDocument: "长标题".repeat(200) },
    }).splitText("第一章 规定\n第一条 正文")
  ).rejects.toThrow("metadata leaves too little room");
});

test("the environment switch restores recursive splitting without source changes", async () => {
  const previous = process.env.DOCUMENT_STRUCTURE_CHUNKING;
  process.env.DOCUMENT_STRUCTURE_CHUNKING = "false";
  try {
    const text = "第一章 政策\n第一条 " + "员工可申请。".repeat(50);
    expect(await splitter().splitText(text)).toEqual(
      await splitter({ structureAware: false }).splitText(text)
    );
  } finally {
    if (previous === undefined) delete process.env.DOCUMENT_STRUCTURE_CHUNKING;
    else process.env.DOCUMENT_STRUCTURE_CHUNKING = previous;
  }
});

test("an oversized row retains all its characters with column context", async () => {
  const header = "| 编号 | 说明 |\n| --- | --- |";
  const row = "| A | " + "中文长说明。".repeat(100) + "结尾标记 |";
  const chunks = await splitter({ chunkSize: 180, chunkOverlap: 0 }).splitText(
    header + "\n" + row
  );
  expect(chunks.length).toBeGreaterThan(3);
  expect(
    chunks.every((chunk) => chunk.startsWith(header) && chunk.length <= 180)
  ).toBe(true);
  expect(chunks.at(-1)).toContain("结尾标记");
});

test("table captions repeat with column headers", async () => {
  const header = "| 岗位 | 金额 |\n| --- | --- |";
  const rows = Array.from({ length: 30 }, (_, i) => `| 岗位${i} | ${i}元 |`);
  const chunks = await splitter({ chunkSize: 240 }).splitText(
    `# 补贴\n表1 交通费用标准\n\n${header}\n${rows.join("\n")}`
  );
  const tables = chunks.filter((chunk) => /岗位\d/.test(chunk));
  expect(
    tables.every(
      (chunk) =>
        chunk.includes("table: 表1 交通费用标准") && chunk.length <= 240
    )
  ).toBe(true);
});
