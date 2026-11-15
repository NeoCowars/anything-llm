const { v4 } = require("uuid");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
} = require("../../../utils/files");
const { tokenizeString } = require("../../../utils/tokenizer");
const { default: slugify } = require("slugify");
const PDFLoader = require("./PDFLoader");
const OCRLoader = require("../../../utils/OCRLoader");
const { createReport, persistReport } = require("../../../utils/ingestion");

async function asPdf({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}) {
  const pdfLoader = new PDFLoader(fullFilePath, {
    splitPages: true,
    includeEmptyPages: true,
  });

  console.log(`-- Working ${filename} --`);
  let docs;
  try {
    docs = await pdfLoader.load();
  } catch (error) {
    const ingestion = persistReport(
      createReport({
        format: "pdf",
        filename,
        status: "failed",
        warnings: [{ code: "PDF_OPEN_FAILED", message: error.message }],
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

  const pagesNeedingOCR = docs
    .filter((doc) => !doc.pageContent?.trim())
    .map((doc) => doc.metadata.loc.pageNumber);

  let ocrError = null;
  if (pagesNeedingOCR.length > 0) {
    console.log(
      `[asPDF] ${pagesNeedingOCR.length} page(s) without text in ${filename}. Will attempt OCR for those pages.`
    );
    let ocrDocs = [];
    try {
      ocrDocs = await new OCRLoader({
        targetLanguages: options?.ocr?.langList,
      }).ocrPDF(fullFilePath, { pageNumbers: pagesNeedingOCR });
    } catch (error) {
      ocrError = error.message;
      console.warn(
        `[asPDF] OCR failed for ${filename}; keeping available native text.`,
        error.message
      );
    }
    const ocrByPage = new Map(
      ocrDocs.map((doc) => [doc.metadata.loc.pageNumber, doc])
    );
    // Keep the original page order and never replace native text with OCR.
    docs = docs.map((doc) => {
      if (doc.pageContent?.trim()) return doc;
      const recognized = ocrByPage.get(doc.metadata.loc.pageNumber);
      return recognized
        ? {
            ...recognized,
            metadata: {
              ...doc.metadata,
              ...recognized.metadata,
              ...(doc.metadata.extractionError
                ? { extractionError: doc.metadata.extractionError }
                : {}),
            },
          }
        : doc;
    });
    const emptyPageCount = docs.filter(
      (doc) => !doc.pageContent?.trim()
    ).length;
    if (emptyPageCount > 0)
      console.warn(
        `[asPDF] ${emptyPageCount} page(s) still have no text after OCR in ${filename}; these may be blank pages or OCR failures.`
      );
  }

  let content = "";
  const ocrPages = new Set(pagesNeedingOCR);
  const pages = docs.map((doc) => {
    const pageNumber = doc.metadata.loc.pageNumber;
    const hasText = !!doc.pageContent?.trim();
    if (hasText && content) content += "\n\n";
    const start = hasText ? content.length : null;
    if (hasText) content += doc.pageContent;
    return {
      pageNumber,
      method: ocrPages.has(pageNumber) ? "ocr" : "native",
      status: hasText ? "text" : doc.metadata.ocr?.status || "unresolved",
      start,
      end: hasText ? content.length : null,
      ...(doc.metadata.extractionError
        ? { extractionError: doc.metadata.extractionError }
        : {}),
      ...(doc.metadata.ocr?.error || (ocrPages.has(pageNumber) && ocrError)
        ? { error: doc.metadata.ocr?.error || ocrError }
        : {}),
    };
  });
  const unresolved = pages.filter((page) => page.status !== "text");
  const warnings = [];
  if (unresolved.length)
    warnings.push({
      code: "PDF_PAGES_UNRESOLVED",
      pageNumbers: unresolved.map((page) => page.pageNumber),
      message: `${unresolved.length} of ${pages.length} PDF pages have no usable text. They may be blank or unrecognized; check the page report.`,
    });
  if (pages.some((page) => page.extractionError))
    warnings.push({
      code: "PDF_TEXT_EXTRACTION_ERRORS",
      message:
        "Some PDF pages could not be read as native text; see the page report for OCR recovery results.",
    });
  if (!content && !warnings.length)
    warnings.push({
      code: "PDF_NO_TEXT",
      message: "No usable PDF text was found.",
    });
  const ingestion = persistReport(
    createReport({
      format: "pdf",
      filename,
      pages,
      warnings,
      offsetUnit: "utf16-code-units",
      ...(!content ? { status: "failed" } : {}),
    })
  );

  if (!content) {
    console.error(`[asPDF] Resulting text content was empty for ${filename}.`);
    if (!options.absolutePath) trashFile(fullFilePath);
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
      ...ingestion,
    };
  }

  const data = {
    id: v4(),
    url: "file://" + fullFilePath,
    title: metadata.title || filename,
    docAuthor:
      metadata.docAuthor ||
      docs[0]?.metadata?.pdf?.info?.Creator ||
      "no author found",
    description:
      metadata.description ||
      docs[0]?.metadata?.pdf?.info?.Title ||
      "No description found.",
    docSource: metadata.docSource || "pdf file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(" ").length,
    pageContent: content,
    documentFormat: "text",
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

module.exports = asPdf;
