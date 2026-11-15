const { parseDocumentStructure } = require(".");

const SEPARATORS = [
  "\n\n",
  "\n",
  "。",
  "！",
  "？",
  "；",
  ". ",
  "! ",
  "? ",
  "; ",
  " ",
  "，",
  "\u200b",
];

function splitBounded(text, limit, overlap) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + limit, text.length);
    if (end < text.length) {
      const minimum = start + Math.floor(limit / 2);
      const window = text.slice(minimum, end);
      for (const separator of SEPARATORS) {
        const found = window.lastIndexOf(separator);
        if (found >= 0) {
          end = minimum + found + separator.length;
          break;
        }
      }
      if (
        /[\uD800-\uDBFF]/.test(text[end - 1]) &&
        /[\uDC00-\uDFFF]/.test(text[end])
      )
        end--;
    }
    const part = text.slice(start, end).trim();
    if (part) chunks.push(part);
    if (end === text.length) break;
    let next = Math.max(start + 1, end - Math.min(overlap, limit - 1));
    if (
      /[\uDC00-\uDFFF]/.test(text[next]) &&
      /[\uD800-\uDBFF]/.test(text[next - 1])
    )
      next++;
    start = Math.min(next, end);
  }
  return chunks;
}

function tail(text, limit) {
  if (text.length <= limit) return text;
  let start = text.length - Math.max(0, limit - 1);
  if (/[\uDC00-\uDFFF]/.test(text[start])) start++;
  return `…${text.slice(start)}`;
}

function contextOf(block, size) {
  if (size < 48) return "";
  const fields = [
    ["section", block.path.join(" > ")],
    ["clause", block.clause],
    ["table", block.caption],
  ].filter(([, value]) => value);
  if (!fields.length) return "";
  const budget = Math.min(256, Math.floor(size / 3));
  let remaining =
    budget -
    fields.reduce((sum, [label]) => sum + label.length + 2, 0) -
    (fields.length - 1);
  if (remaining < fields.length * 2) return "";
  const slots = fields.map(() => 0);
  while (remaining > 0) {
    let assigned = false;
    for (let i = 0; i < fields.length && remaining > 0; i++) {
      if (slots[i] >= fields[i][1].length) continue;
      slots[i]++;
      remaining--;
      assigned = true;
    }
    if (!assigned) break;
  }
  return (
    fields
      .map(([label, value], i) => label + ": " + tail(value, slots[i]))
      .join("\n") + "\n\n"
  );
}

async function splitStructure(text, { format, chunkSize, chunkOverlap }) {
  const structure = parseDocumentStructure(text, { format });
  if (!structure.structured) return null;
  if (!Number.isFinite(chunkSize) || chunkSize < 8)
    throw new RangeError(
      "Document metadata leaves too little room for structured chunks. Increase the chunk size or shorten the document metadata."
    );
  const chunks = [];
  const split = async (body, limit) => splitBounded(body, limit, chunkOverlap);
  let pending = null;
  const flush = async () => {
    if (!pending) return;
    const context = contextOf(pending.block, chunkSize);
    for (const part of await split(pending.text, chunkSize - context.length))
      chunks.push(context + part);
    pending = null;
  };
  for (const block of structure.blocks) {
    if (block.type !== "table") {
      const boundary =
        block.type === "heading" ||
        block.type === "clause" ||
        block.type === "code";
      if (
        pending &&
        ((boundary && pending.block.type !== "heading") ||
          block.type === "code" ||
          pending.block.type === "code")
      )
        await flush();
      if (!pending) pending = { block, text: block.text };
      else {
        pending.text += `\n\n${block.text}`;
        // A heading and the first following clause share a chunk when possible.
        pending.block = block;
      }
      continue;
    }
    await flush();
    const context = contextOf(block, chunkSize);
    const budget = chunkSize - context.length;
    if (block.text.length <= budget) {
      chunks.push(context + block.text);
      continue;
    }
    if (!block.rows.length || block.header.length + 2 >= budget / 2) {
      // Preserve all source text when the header itself is too large to repeat.
      for (const part of await split(block.text, budget))
        chunks.push(context + part);
      continue;
    }
    const prefix = `${context}${block.header}\n`;
    const rowBudget = chunkSize - prefix.length;
    let rows = [];
    let length = 0;
    const writeRows = () => {
      if (rows.length) chunks.push(prefix + rows.join("\n"));
      rows = [];
      length = 0;
    };
    for (const row of block.rows) {
      if (row.text.length > rowBudget) {
        writeRows();
        for (const part of await split(row.text, rowBudget))
          chunks.push(prefix + part);
        continue;
      }
      if (length + row.text.length + (rows.length ? 1 : 0) > rowBudget)
        writeRows();
      length += row.text.length + (rows.length ? 1 : 0);
      rows.push(row.text);
    }
    writeRows();
  }
  await flush();
  return chunks;
}

module.exports = { splitStructure, splitBounded };
