const fs = require("fs");
const os = require("os");
const path = require("path");
const { VALID_LANGUAGE_CODES } = require("./validLangs");
const { processPages } = require("./processPages");

class OCRLoader {
  /**
   * The language code(s) to use for the OCR.
   * @type {string[]}
   */
  language;
  /**
   * The cache directory for the OCR.
   * @type {string}
   */
  cacheDir;

  /**
   * The constructor for the OCRLoader.
   * @param {Object} options - The options for the OCRLoader.
   * @param {string} options.targetLanguages - The target languages to use for the OCR as a comma separated string. eg: "eng,deu,..."
   */
  constructor({ targetLanguages = "chi_sim,eng" } = {}) {
    this.language = this.parseLanguages(targetLanguages);
    this.cacheDir = path.resolve(
      process.env.STORAGE_DIR
        ? path.resolve(process.env.STORAGE_DIR, `models`, `tesseract`)
        : path.resolve(__dirname, `../../../server/storage/models/tesseract`)
    );

    // Ensure the cache directory exists or else Tesseract will persist the cache in the default location.
    if (!fs.existsSync(this.cacheDir))
      fs.mkdirSync(this.cacheDir, { recursive: true });
    this.log(
      `OCRLoader initialized with language support for:`,
      this.language.map((lang) => VALID_LANGUAGE_CODES[lang]).join(", ")
    );
  }

  /**
   * Parses the language code from a provided comma separated string of language codes.
   * @param {string} language - The language code to parse.
   * @returns {string[]} The parsed language code.
   */
  parseLanguages(language = null) {
    try {
      if (!language || typeof language !== "string") return ["chi_sim", "eng"];
      const langList = language
        .split(",")
        .map((lang) => (lang.trim() !== "" ? lang.trim() : null))
        .filter(Boolean)
        .filter((lang) => VALID_LANGUAGE_CODES.hasOwnProperty(lang));
      if (langList.length === 0) return ["chi_sim", "eng"];
      return langList;
    } catch (e) {
      this.log(`Error parsing languages: ${e.message}`, e.stack);
      return ["chi_sim", "eng"];
    }
  }

  log(text, ...args) {
    console.log(`\x1b[36m[OCRLoader]\x1b[0m ${text}`, ...args);
  }

  /**
   * Loads a PDF file and returns an array of documents.
   * Recognizes scanned pages, optionally restricted to selected 1-based page numbers.
   * @param {string} filePath - The PDF file to recognize.
   * @param {Object} options - OCR execution options.
   * @param {number[]|null} options.pageNumbers - Pages to recognize; null means all pages.
   * @returns {Promise<{pageContent: string, metadata: object}[]>} An array of documents with page content and metadata.
   */
  async ocrPDF(
    filePath,
    {
      maxExecutionTime = 300_000,
      batchSize = 10,
      maxWorkers = null,
      pageNumbers = null,
    } = {}
  ) {
    if (
      !filePath ||
      !fs.existsSync(filePath) ||
      !fs.statSync(filePath).isFile()
    ) {
      this.log(`File ${filePath} does not exist. Skipping OCR.`);
      return [];
    }

    if (pageNumbers !== null && !Array.isArray(pageNumbers))
      throw new TypeError("OCR pageNumbers must be an array of page numbers.");
    if (pageNumbers?.length === 0) return [];

    const documentTitle = path.basename(filePath);
    this.log(`Starting OCR of ${documentTitle}`);
    const pdfjs = await import("pdf-parse/lib/pdf.js/v2.0.550/build/pdf.js");
    let buffer = fs.readFileSync(filePath);

    const pdfDocument = await pdfjs.getDocument({ data: buffer });
    try {
      const targetPages =
        pageNumbers === null
          ? Array.from(
              { length: pdfDocument.numPages },
              (_, index) => index + 1
            )
          : [...new Set(pageNumbers)].sort((a, b) => a - b);
      if (
        targetPages.some(
          (page) =>
            !Number.isInteger(page) || page < 1 || page > pdfDocument.numPages
        )
      )
        throw new RangeError(
          "OCR pageNumbers must refer to existing PDF pages."
        );
      if (targetPages.length === 0) return [];

      const meta = await pdfDocument.getMetadata().catch(() => null);
      const metadata = {
        source: filePath,
        pdf: {
          version: "v2.0.550",
          info: meta?.info,
          metadata: meta?.metadata,
          totalPages: pdfDocument.numPages,
        },
      };

      const pdfSharp = new PDFSharp({
        validOps: [
          pdfjs.OPS.paintJpegXObject,
          pdfjs.OPS.paintImageXObject,
          pdfjs.OPS.paintInlineImageXObject,
        ],
      });
      const { createWorker, OEM } = require("tesseract.js");
      return await processPages({
        pdfDocument,
        pdfSharp,
        metadata,
        targetPages,
        createWorker: () =>
          createWorker(this.language, OEM.LSTM_ONLY, {
            cachePath: this.cacheDir,
          }),
        maxWorkers: maxWorkers ?? Math.min(os.cpus().length || 1, 4),
        batchSize,
        maxExecutionTime,
        destroyDocument: false,
        log: (...args) => this.log(...args),
      });
    } finally {
      try {
        await pdfDocument.destroy?.();
      } catch (error) {
        this.log(`PDF cleanup failed: ${error.message}`);
      }
    }
  }

  /**
   * Loads an image file and returns the OCRed text.
   * @param {string} filePath - The path to the image file.
   * @param {Object} options - The options for the OCR.
   * @param {number} options.maxExecutionTime - The maximum execution time of the OCR in milliseconds.
   * @returns {Promise<string>} The OCRed text.
   */
  async ocrImage(filePath, { maxExecutionTime = 300_000 } = {}) {
    let content = "";
    let worker = null;
    if (
      !filePath ||
      !fs.existsSync(filePath) ||
      !fs.statSync(filePath).isFile()
    ) {
      this.log(`File ${filePath} does not exist. Skipping OCR.`);
      return null;
    }

    const documentTitle = path.basename(filePath);
    try {
      this.log(`Starting OCR of ${documentTitle}`);
      const startTime = Date.now();
      const { createWorker, OEM } = require("tesseract.js");
      worker = await createWorker(this.language, OEM.LSTM_ONLY, {
        cachePath: this.cacheDir,
      });

      // Race the timeout with the OCR
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              `OCR job took too long to complete (${
                maxExecutionTime / 1000
              } seconds)`
            )
          );
        }, maxExecutionTime);
      });

      const processImage = async () => {
        const { data } = await worker.recognize(filePath, {}, "text");
        content = data.text;
      };

      await Promise.race([timeoutPromise, processImage()]);
      this.log(`Completed OCR of ${documentTitle}!`, {
        executionTime: `${((Date.now() - startTime) / 1000).toFixed(2)}s`,
      });

      return content;
    } catch (e) {
      this.log(`Error: ${e.message}`);
      return null;
    } finally {
      //eslint-disable-next-line
      if (!worker) return;
      await worker.terminate();
    }
  }
}

/**
 * pdf.js ImageKind.GRAYSCALE_1BPP. Packed 1-bit rows are ceil(width/8) bytes.
 * @type {number}
 */
const PDFJS_GRAYSCALE_1BPP = 1;

/**
 * Unpack pdf.js packed 1-bit DeviceGray into 8-bit grayscale Sharp can ingest.
 * Bit 1 is white, bit 0 is black (PDF DeviceGray).
 *
 * @param {Buffer|Uint8Array} packed
 * @param {number} width
 * @param {number} height
 * @returns {Buffer|null}
 */
function unpackPackedGray1Bpp(packed, width, height) {
  if (!packed || width <= 0 || height <= 0) return null;
  const rowBytes = Math.ceil(width / 8);
  if (packed.length < rowBytes * height) return null;

  const out = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    for (let x = 0; x < width; x++) {
      const byte = packed[rowStart + (x >> 3)];
      const bit = (byte >> (7 - (x & 7))) & 1;
      out[y * width + x] = bit ? 255 : 0;
    }
  }
  return out;
}

/**
 * Build a Sharp `raw` input from a pdf.js image object.
 * Copies the source buffer so concurrent OCR workers cannot share backing memory.
 * 1-bit CCITT/bitonal scans (issue #6118) are expanded to 8-bit gray.
 *
 * @param {{width?: number, height?: number, data?: ArrayLike<number>, kind?: number}} img
 * @returns {{data: Buffer, width: number, height: number, channels: number}|null}
 */
function toSharpRawInput(img) {
  const width = img?.width;
  const height = img?.height;
  if (!width || !height || !img.data) return null;

  const src = Buffer.from(img.data);
  const isPacked1Bpp =
    img.kind === PDFJS_GRAYSCALE_1BPP ||
    src.length === Math.ceil(width / 8) * height;

  if (isPacked1Bpp) {
    const unpacked = unpackPackedGray1Bpp(src, width, height);
    if (!unpacked) return null;
    return { data: unpacked, width, height, channels: 1 };
  }

  const channels = src.length / width / height;
  if (![1, 2, 3, 4].includes(channels)) return null;
  return { data: src, width, height, channels };
}

/**
 * Converts a PDF page to a buffer using Sharp.
 * @param {Object} options - The options for the Sharp PDF page object.
 * @param {Object} options.page - The PDFJS page proxy object.
 * @returns {Promise<Buffer>} The buffer of the page.
 */
class PDFSharp {
  constructor({ validOps = [] } = {}) {
    this.sharp = null;
    this.validOps = validOps;
  }

  log(text, ...args) {
    console.log(`\x1b[36m[PDFSharp]\x1b[0m ${text}`, ...args);
  }

  async init() {
    this.sharp = (await import("sharp")).default;
  }

  /**
   * Converts a PDF page to a buffer.
   * @param {Object} options - The options for the Sharp PDF page object.
   * @param {Object} options.page - The PDFJS page proxy object.
   * @returns {Promise<Buffer>} The buffer of the page.
   */
  async pageToBuffer({ page }) {
    if (!this.sharp) await this.init();
    try {
      this.log(`Converting page ${page.pageNumber} to image...`);
      const ops = await page.getOperatorList();
      const pageImages = ops.fnArray.length;

      for (let i = 0; i < pageImages; i++) {
        try {
          if (!this.validOps.includes(ops.fnArray[i])) continue;

          const name = ops.argsArray[i][0];
          const img = await page.objs.get(name);
          const raw = toSharpRawInput(img);
          if (!raw) continue;
          const { data, width, height, channels } = raw;
          const targetDPI = 70;
          const targetWidth = Math.floor(width * (targetDPI / 72));
          const targetHeight = Math.floor(height * (targetDPI / 72));

          const image = this.sharp(data, {
            raw: { width, height, channels },
            density: targetDPI,
          })
            .resize({
              width: targetWidth,
              height: targetHeight,
              fit: "fill",
            })
            .withMetadata({
              density: targetDPI,
              resolution: targetDPI,
            })
            .png();

          // For debugging purposes
          // await image.toFile(path.resolve(__dirname, `../../storage/`, `pg${page.pageNumber}.png`));
          return await image.toBuffer();
        } catch (error) {
          this.log(`Iteration error: ${error.message}`, error.stack);
          continue;
        }
      }
      this.log(`No valid images found on page ${page.pageNumber}`);
      return null;
    } catch (error) {
      this.log(`Error: ${error.message}`, error.stack);
      return null;
    }
  }
}

OCRLoader.toSharpRawInput = toSharpRawInput;
OCRLoader.unpackPackedGray1Bpp = unpackPackedGray1Bpp;
module.exports = OCRLoader;
