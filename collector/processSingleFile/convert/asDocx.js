const { v4 } = require("uuid");
const mammoth = require("mammoth");
const {
  documentHtmlToMarkdown,
} = require("../../processLink/helpers/htmlToMarkdown");
const { createReport, persistReport } = require("../../utils/ingestion");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
} = require("../../utils/files");
const { tokenizeString } = require("../../utils/tokenizer");
const { default: slugify } = require("slugify");

async function asDocX({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}) {
  console.log(`-- Working ${filename} --`);
  let content;
  const warnings = [];
  try {
    let images = 0;
    const converted = await mammoth.convertToHtml(
      { path: fullFilePath },
      {
        styleMap: Array.from({ length: 6 }, (_, i) => [
          `p[style-name='标题 ${i + 1}'] => h${i + 1}:fresh`,
          `p[style-name='标题${i + 1}'] => h${i + 1}:fresh`,
        ]).flat(),
        convertImage: mammoth.images.imgElement(async (image) => {
          images++;
          return { src: "", alt: image.altText || "OCR required" };
        }),
      }
    );
    content = documentHtmlToMarkdown(converted.value);
    for (const message of converted.messages || [])
      warnings.push({
        code: "DOCX_CONVERSION_WARNING",
        message: message.message,
      });
    if (images)
      warnings.push({
        code: "DOCX_IMAGES_NOT_OCR",
        message: `${images} embedded DOCX image(s) were not OCRed. Image placeholders are included; check the source document.`,
      });
    if (
      /<(?:td|th)\b[^>]*(?:rowspan|colspan)=["'](?:[2-9]|\d{2,})["']/i.test(
        converted.value
      )
    )
      warnings.push({
        code: "DOCX_MERGED_TABLE",
        message:
          "DOCX tables contain merged cells. Their spans are represented as empty slots; verify multi-level headers and row associations.",
      });
    if (
      images &&
      !documentHtmlToMarkdown(
        converted.value.replace(/<img\b[^>]*>/gi, "")
      ).trim()
    )
      throw new Error(
        "DOCX contains images but no usable text. Embedded-image OCR is required."
      );
  } catch (error) {
    const ingestion = persistReport(
      createReport({
        format: "docx",
        filename,
        status: "failed",
        warnings: [
          ...warnings,
          { code: "DOCX_PARSE_FAILED", message: error.message },
        ],
      })
    );
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: error.message,
      documents: [],
      ...ingestion,
    };
  }

  if (!content?.trim()) {
    console.error(`Resulting text content was empty for ${filename}.`);
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
      ...persistReport(
        createReport({
          format: "docx",
          filename,
          status: "failed",
          warnings: [
            { code: "DOCX_NO_TEXT", message: "No usable DOCX text was found." },
          ],
        })
      ),
    };
  }

  const ingestion = persistReport(
    createReport({
      format: "docx",
      filename,
      warnings,
      status: warnings.some((warning) => warning.code === "DOCX_IMAGES_NOT_OCR")
        ? "partial"
        : "complete",
    })
  );
  const data = {
    id: v4(),
    url: "file://" + fullFilePath,
    title: metadata.title || filename,
    docAuthor: metadata.docAuthor || "no author found",
    description: metadata.description || "No description found.",
    docSource: metadata.docSource || "docx file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(" ").length,
    pageContent: content,
    documentFormat: "markdown",
    structureParser: "mammoth-markdown-v1",
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

module.exports = asDocX;
