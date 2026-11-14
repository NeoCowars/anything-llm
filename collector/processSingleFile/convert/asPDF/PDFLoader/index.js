const fs = require("fs").promises;

class PDFLoader {
  constructor(filePath, { splitPages = true, includeEmptyPages = false } = {}) {
    this.filePath = filePath;
    this.splitPages = splitPages;
    this.includeEmptyPages = includeEmptyPages;
  }

  async load() {
    const buffer = await fs.readFile(this.filePath);
    const { getDocument, version } = await this.getPdfJS();

    const pdf = await getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;

    try {
      const meta = await pdf.getMetadata().catch(() => null);
      const documents = [];

      for (let i = 1; i <= pdf.numPages; i += 1) {
        let text = "";
        let extractionError = null;
        try {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          let lastY;
          const textItems = [];
          for (const item of content.items) {
            if ("str" in item) {
              if (lastY === item.transform[5] || !lastY) {
                textItems.push(item.str);
              } else {
                textItems.push(`\n${item.str}`);
              }
              lastY = item.transform[5];
            }
          }
          text = textItems.join("").trim();
        } catch (error) {
          if (!this.includeEmptyPages) throw error;
          extractionError = error.message;
        }

        if (!text && !this.includeEmptyPages) continue;
        documents.push({
          pageContent: text,
          metadata: {
            source: this.filePath,
            pdf: {
              version,
              info: meta?.info,
              metadata: meta?.metadata,
              totalPages: pdf.numPages,
            },
            loc: { pageNumber: i },
            ...(extractionError ? { extractionError } : {}),
          },
        });
      }

      if (this.splitPages) {
        return documents;
      }

      if (documents.length === 0) {
        return [];
      }

      return [
        {
          pageContent: documents.map((doc) => doc.pageContent).join("\n\n"),
          metadata: {
            source: this.filePath,
            pdf: {
              version,
              info: meta?.info,
              metadata: meta?.metadata,
              totalPages: pdf.numPages,
            },
          },
        },
      ];
    } finally {
      try {
        await pdf.destroy?.();
      } catch (error) {
        console.warn(`PDF cleanup failed: ${error.message}`);
      }
    }
  }

  async getPdfJS() {
    try {
      const pdfjs = await import("pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js");
      return { getDocument: pdfjs.getDocument, version: pdfjs.version };
    } catch (e) {
      console.error(e);
      throw new Error(
        "Failed to load pdf-parse. Please install it with eg. `npm install pdf-parse`."
      );
    }
  }
}

module.exports = PDFLoader;
