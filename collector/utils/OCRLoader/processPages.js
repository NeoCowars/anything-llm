/** Recognize pages independently and freeze partial results when the deadline expires. */
async function processPages({
  pdfDocument,
  pdfSharp,
  metadata,
  targetPages,
  createWorker,
  maxWorkers,
  batchSize,
  maxExecutionTime,
  destroyDocument = true,
  log = () => {},
}) {
  for (const [name, value] of Object.entries({
    maxWorkers,
    batchSize,
    maxExecutionTime,
  }))
    if (!Number.isInteger(value) || value <= 0)
      throw new RangeError(`${name} must be a positive integer.`);

  const workers = [];
  const results = new Map();
  let stopped = false;
  let timeout;
  let failure = null;
  const record = (pageNumber, status, text = "", error = null) => ({
    pageContent: text,
    metadata: {
      ...metadata,
      loc: { pageNumber },
      ocr: { status, ...(error ? { error } : {}) },
    },
  });
  const terminate = async (worker) => {
    try {
      await worker.terminate();
    } catch (error) {
      log(`OCR worker cleanup failed: ${error.message}`);
    }
  };

  const run = async () => {
    await pdfSharp.init();
    if (stopped) return;
    await Promise.all(
      Array.from(
        { length: Math.min(maxWorkers, batchSize, targetPages.length) },
        async () => {
          const worker = await createWorker();
          if (stopped) await terminate(worker);
          else workers.push(worker);
        }
      )
    );
    for (
      let offset = 0;
      !stopped && offset < targetPages.length;
      offset += batchSize
    ) {
      const queue = targetPages.slice(offset, offset + batchSize);
      await Promise.all(
        workers.map(async (worker) => {
          while (!stopped && queue.length) {
            const pageNumber = queue.shift();
            try {
              const page = await pdfDocument.getPage(pageNumber);
              if (stopped) return;
              const image = await pdfSharp.pageToBuffer({ page });
              if (stopped) return;
              if (!image) {
                results.set(pageNumber, record(pageNumber, "no_image"));
                continue;
              }
              const { data } = await worker.recognize(image, {}, "text");
              if (stopped) return;
              const text = data.text || "";
              results.set(
                pageNumber,
                record(pageNumber, text.trim() ? "recognized" : "no_text", text)
              );
            } catch (error) {
              if (stopped) return;
              results.set(
                pageNumber,
                record(pageNumber, "failed", "", error.message)
              );
              log(`OCR page ${pageNumber} failed: ${error.message}`);
            }
          }
        })
      );
    }
  };

  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(
            `OCR exceeded its ${maxExecutionTime} ms deadline.`
          );
          error.code = "OCR_TIMEOUT";
          reject(error);
        }, maxExecutionTime);
      }),
    ]);
  } catch (error) {
    failure = {
      status: error.code === "OCR_TIMEOUT" ? "timeout" : "failed",
      error: error.message,
    };
    log(`OCR stopped: ${error.message}`);
  } finally {
    stopped = true;
    clearTimeout(timeout);
    await Promise.all(workers.map(terminate));
    try {
      if (destroyDocument) await pdfDocument.destroy?.();
    } catch (error) {
      log(`PDF cleanup failed: ${error.message}`);
    }
  }

  return targetPages.map(
    (pageNumber) =>
      results.get(pageNumber) ||
      record(pageNumber, failure?.status || "failed", "", failure?.error)
  );
}

module.exports = { processPages };
