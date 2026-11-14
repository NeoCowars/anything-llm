const { v4 } = require("uuid");
const fs = require("fs");
const { tokenizeString } = require("../../utils/tokenizer");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
} = require("../../utils/files");
const { default: slugify } = require("slugify");
const { decodeText } = require("../../utils/textEncoding");
const { createReport, persistReport } = require("../../utils/ingestion");

async function asTxt({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}) {
  let content = "";
  let decoded;
  try {
    decoded = decodeText(
      fs.readFileSync(fullFilePath),
      options.textEncoding || metadata.textEncoding || "auto"
    );
    content = decoded.content;
  } catch (err) {
    console.error("Could not read file!", err);
    const report = createReport({
      format: "text",
      filename,
      status: "failed",
      warnings: [{ code: "TEXT_DECODE_FAILED", message: err.message }],
    });
    const ingestion = persistReport(report);
    if (!options.absolutePath) trashFile(fullFilePath);
    return { success: false, reason: err.message, documents: [], ...ingestion };
  }

  if (!content?.trim()) {
    console.error(`Resulting text content was empty for ${filename}.`);
    const ingestion = persistReport(
      createReport({
        format: "text",
        filename,
        status: "failed",
        encoding: decoded.encoding,
        warnings: [
          { code: "TEXT_NO_TEXT", message: "No usable text was found." },
        ],
      })
    );
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
      ...ingestion,
    };
  }

  console.log(`-- Working ${filename} --`);
  const ingestion = persistReport(
    createReport({
      format: "text",
      filename,
      encoding: decoded.encoding,
      encodingDetection: decoded.detection,
      warnings: decoded.warnings,
    })
  );
  const data = {
    id: v4(),
    url: "file://" + fullFilePath,
    title: metadata.title || filename,
    docAuthor: metadata.docAuthor || "Unknown",
    description: metadata.description || "Unknown",
    docSource: metadata.docSource || "a text file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(" ").length,
    pageContent: content,
    token_count_estimate: tokenizeString(content),
    ...ingestion,
  };

  const document = writeToServerDocuments({
    data,
    filename: `${slugify(filename)}-${data.id}`,
    options: { parseOnly: options.parseOnly },
  });
  if (!options.absolutePath) trashFile(fullFilePath);
  console.log(`[SUCCESS]: ${filename} converted & ready for embedding.\n`);
  return { success: true, reason: null, documents: [document], ...ingestion };
}

module.exports = asTxt;
