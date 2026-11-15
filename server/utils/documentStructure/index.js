// Offsets refer to the original string in UTF-16 code units. Parsing does not
// rewrite source text or infer tables from whitespace in a PDF text layer.
const NUMBER = "[零〇一二三四五六七八九十百千万两0-9０-９]+";
const chapter = new RegExp(`^第${NUMBER}(部分|篇|章|节)(?:\\s*|[、:：])`);
const article = new RegExp(`^(第${NUMBER}条(?:之${NUMBER})?)(?:\\s*|[、:：])`);

function headingOf(line) {
  const markdown = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*$/);
  if (markdown) return { level: markdown[1].length, title: markdown[2] };
  if (line.length > 160 || /[。；;！!？?]/u.test(line)) return null;
  const chinese = line.match(chapter);
  if (chinese)
    return { level: { 篇: 1, 部分: 1, 章: 2, 节: 3 }[chinese[1]], title: line };
  const english = line.match(/^(Chapter|Section)\s+[\dIVXLCDM]+(?:\b|[.:])/i);
  if (english)
    return { level: /^chapter$/i.test(english[1]) ? 1 : 2, title: line };
  const numbered = line.match(/^(\d+(?:\.\d+)+)\s+\S/);
  if (numbered && !/[，,:：]/u.test(line))
    return {
      level: Math.min(numbered[1].split(".").length + 1, 6),
      title: line,
    };
  return null;
}

function clauseOf(line) {
  const main =
    line.match(article) || line.match(/^(Article\s+\d+[A-Za-z]?)(?:[.:\s]|$)/i);
  if (main) return { label: main[1], level: 1 };
  const sub = line.match(/^([（(][一二三四五六七八九十百0-9]+[）)])\s*\S/);
  if (sub) return { label: sub[1], level: 3 };
  const list = line.match(
    /^(\d+[、．.]|[一二三四五六七八九十百]+、)(?!\d)\s*\S/
  );
  return list ? { label: list[1], level: 2 } : null;
}

function markdownCells(line) {
  const cells = [];
  let cell = "";
  let escaped = false;
  let ticks = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (escaped) {
      cell += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      cell += char;
      escaped = true;
      continue;
    }
    if (char === "`") {
      let count = 1;
      while (line[i + 1] === "`") {
        count++;
        i++;
      }
      if (!ticks) ticks = count;
      else if (ticks === count) ticks = 0;
      cell += "`".repeat(count);
      continue;
    }
    if (char === "|" && !ticks) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  if (line.trim().startsWith("|")) cells.shift();
  if (line.trim().endsWith("|") && cells.at(-1) === "") cells.pop();
  return cells;
}

// RFC 4180 records, including quoted newlines and doubled quotes. An invalid
// CSV falls back to plain text rather than losing records during recovery.
function csvRecords(text) {
  const records = [];
  let start = 0;
  let quoted = false;
  let fieldStart = true;
  let closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') i++;
        else {
          quoted = false;
          closed = true;
        }
      }
      continue;
    }
    if (c === '"') {
      if (!fieldStart || closed) return null;
      quoted = true;
      fieldStart = false;
    } else if (c === ",") {
      fieldStart = true;
      closed = false;
    } else if (c === "\n" || c === "\r") {
      if (i > start)
        records.push({ start, end: i, text: text.slice(start, i) });
      if (c === "\r" && text[i + 1] === "\n") i++;
      start = i + 1;
      fieldStart = true;
      closed = false;
    } else {
      if (closed) return null;
      fieldStart = false;
    }
  }
  if (quoted) return null;
  if (start < text.length)
    records.push({ start, end: text.length, text: text.slice(start) });
  return records;
}

function parseDocumentStructure(text, { format = "text" } = {}) {
  if (typeof text !== "string" || !text.trim())
    return { version: 1, blocks: [], structured: false };
  if (format === "csv") {
    const records = csvRecords(text);
    if (records?.length > 1)
      return {
        version: 1,
        structured: true,
        blocks: [
          {
            type: "table",
            start: 0,
            end: text.length,
            text,
            path: [],
            header: records[0].text,
            headerSource: "first-record",
            rows: records.slice(1),
          },
        ],
      };
    return {
      version: 1,
      structured: false,
      blocks: [
        { type: "paragraph", start: 0, end: text.length, text, path: [] },
      ],
    };
  }
  if (format === "json" || format === "code")
    return {
      version: 1,
      structured: false,
      blocks: [
        { type: "paragraph", start: 0, end: text.length, text, path: [] },
      ],
    };

  const lines = [];
  for (const match of text.matchAll(/[^\n]+\n?|\n/g))
    lines.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0].replace(/\r?\n$/, ""),
    });
  const blocks = [];
  const stack = [];
  const clauses = [];
  let clause = null;
  let current = null;
  const flush = () => {
    if (current) {
      current.text = text.slice(current.start, current.end).trim();
      blocks.push(current);
      current = null;
    }
  };
  const block = (type, first, last, details = {}) => ({
    type,
    start: first.start,
    end: last.end,
    text: text.slice(first.start, last.end).trim(),
    path: stack.map((item) => item.title),
    ...(clause ? { clause } : {}),
    ...details,
  });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const value = line.text.trim();
    if (!value) {
      flush();
      continue;
    }
    const fence = value.match(/^(`{3,}|~{3,})/);
    if (fence) {
      flush();
      const first = i;
      while (++i < lines.length) {
        const closing = lines[i].text.trim();
        if (
          closing[0] === fence[1][0] &&
          new RegExp(`^${fence[1][0]}{${fence[1].length},}\\s*$`).test(closing)
        )
          break;
      }
      i = Math.min(i, lines.length - 1);
      blocks.push(block("code", lines[first], lines[i]));
      continue;
    }
    const cells = markdownCells(value);
    const separator = lines[i + 1] && markdownCells(lines[i + 1].text.trim());
    if (
      value.includes("|") &&
      cells.length >= 1 &&
      separator?.length === cells.length &&
      separator.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      flush();
      const first = i;
      i++;
      const header = text.slice(line.start, lines[i].end).trim();
      const rows = [];
      while (
        lines[i + 1] &&
        markdownCells(lines[i + 1].text).length === cells.length &&
        lines[i + 1].text.includes("|")
      ) {
        i++;
        rows.push({ ...lines[i], text: lines[i].text });
      }
      const candidate = blocks.at(-1)?.text.split(/\r?\n/).at(-1)?.trim();
      const caption =
        candidate?.length <= 160 &&
        /^(?:表\s*[零一二三四五六七八九十百0-9]+|Table\s+\d+)/i.test(candidate)
          ? candidate
          : null;
      blocks.push(
        block("table", lines[first], lines[i], {
          header,
          headerSource: "markdown",
          rows,
          ...(caption ? { caption } : {}),
        })
      );
      continue;
    }
    let heading = headingOf(value);
    const setext =
      !heading && lines[i + 1]?.text.trim().match(/^(={3,}|-{3,})$/);
    if (setext && value.length <= 160)
      heading = { level: setext[1][0] === "=" ? 1 : 2, title: value };
    if (heading) {
      flush();
      clause = null;
      clauses.length = 0;
      while (stack.length && stack.at(-1).level >= heading.level) stack.pop();
      stack.push(heading);
      const first = i;
      if (setext) i++;
      blocks.push(block("heading", lines[first], lines[i], heading));
      continue;
    }
    const label = clauseOf(value);
    if (label) {
      flush();
      while (clauses.length && clauses.at(-1).level >= label.level)
        clauses.pop();
      clauses.push(label);
      clause = clauses.map((item) => item.label).join(" > ");
    }
    if (!current) current = block(label ? "clause" : "paragraph", line, line);
    else current.end = line.end;
  }
  flush();
  return {
    version: 1,
    structured: blocks.some((item) =>
      ["heading", "clause", "table"].includes(item.type)
    ),
    blocks,
  };
}

module.exports = { parseDocumentStructure, markdownCells, csvRecords };
