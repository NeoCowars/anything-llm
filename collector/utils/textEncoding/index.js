const WINDOWS_1252_80_9F =
  "\u20ac\x81\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\x8d\u017d\x8f" +
  "\x90\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\x9d\u017e\u0178";

const ENCODINGS = {
  "utf-8": "utf-8",
  utf8: "utf-8",
  "utf-16le": "utf-16le",
  "utf-16be": "utf-16be",
  gbk: "gb18030",
  gb2312: "gb18030",
  gb18030: "gb18030",
  "windows-1252": "windows-1252",
};

function decode(buffer, encoding) {
  if (encoding === "windows-1252")
    return buffer
      .toString("latin1")
      .replace(
        /[\x80-\x9f]/g,
        (char) => WINDOWS_1252_80_9F[char.charCodeAt(0) - 0x80]
      );
  return new TextDecoder(encoding, { fatal: true }).decode(buffer);
}

/** Prefer Unicode signatures; legacy encoding detection is inherently ambiguous. */
function decodeText(buffer, requestedEncoding = "auto") {
  const requested = String(requestedEncoding || "auto")
    .trim()
    .toLowerCase();
  if (requested !== "auto" && !Object.hasOwn(ENCODINGS, requested))
    throw new Error(`Unsupported text encoding: ${requested}`);

  let encoding;
  let detection;
  let content;
  const warnings = [];
  if (requested !== "auto") {
    encoding = ENCODINGS[requested];
    detection = "explicit";
    content = decode(buffer, encoding);
  } else if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    encoding = "utf-16le";
    detection = "bom";
    content = decode(buffer, encoding);
  } else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    encoding = "utf-16be";
    detection = "bom";
    content = decode(buffer, encoding);
  } else {
    try {
      encoding = "utf-8";
      detection = "validated";
      content = decode(buffer, encoding);
    } catch {
      encoding = "windows-1252";
      detection = "inferred";
      try {
        const chinese = decode(buffer, "gb18030");
        if (/\p{Script=Han}/u.test(chinese)) encoding = "gb18030";
      } catch {
        // A malformed GB18030 sequence must not be silently replaced.
      }
      content = decode(buffer, encoding);
      warnings.push({
        code: "TEXT_ENCODING_INFERRED",
        message: `Text encoding inferred as ${encoding}. Please check the imported text.`,
      });
    }
  }

  if (content.includes("\0"))
    throw new Error(
      "Decoded text contains NUL bytes. Check the file type or specify metadata.textEncoding."
    );
  if (content.includes("\ufffd"))
    warnings.push({
      code: "TEXT_REPLACEMENT_CHARACTERS",
      message:
        "The source contains replacement characters; verify the original text.",
    });
  return { content, encoding, detection, warnings };
}

module.exports = { decodeText };
