const { decodeText } = require("../../utils/textEncoding");

test("UTF-8 Chinese/English and BOM are preserved without guessing", () => {
  expect(decodeText(Buffer.from("中文 English 𠀀"))).toMatchObject({
    content: "中文 English 𠀀",
    encoding: "utf-8",
    detection: "validated",
    warnings: [],
  });
  expect(decodeText(Buffer.from("\ufeff中文"))).toMatchObject({
    content: "中文",
  });
});

test.each(["utf-16le", "utf-16be"])("%s BOM is recognized", (encoding) => {
  const bytes = Buffer.from("\ufeff中文 English", "utf16le");
  if (encoding === "utf-16be") bytes.swap16();
  expect(decodeText(bytes)).toMatchObject({
    content: "中文 English",
    encoding,
    detection: "bom",
  });
});

test("GBK Chinese mixed with English is decoded and marked as inferred", () => {
  const bytes = Buffer.from("d6d0cec4cec4b5b52041424320313233", "hex");
  expect(decodeText(bytes)).toMatchObject({
    content: "中文文档 ABC 123",
    encoding: "gb18030",
    detection: "inferred",
    warnings: [{ code: "TEXT_ENCODING_INFERRED" }],
  });
});

test("GB18030 four-byte supplementary Han characters are supported", () => {
  expect(
    decodeText(Buffer.from("9532823620c0a9d5b9babad7d6", "hex"))
  ).toMatchObject({ content: "𠀀 扩展汉字", encoding: "gb18030" });
});

test("Windows-1252 accents, smart quotes and euro signs retain existing behavior", () => {
  expect(
    decodeText(Buffer.from("636166e9209368656c6c6f942080", "hex"))
  ).toMatchObject({ content: "café “hello” €", encoding: "windows-1252" });
});

test("explicit encoding resolves ambiguous legacy bytes", () => {
  const bytes = Buffer.from([0xe9, 0xe9]);
  expect(decodeText(bytes, "windows-1252")).toMatchObject({
    content: "éé",
    detection: "explicit",
    warnings: [],
  });
  expect(decodeText(bytes).warnings[0].code).toBe("TEXT_ENCODING_INFERRED");
});

test.each(["gbk", "gb2312", "gb18030"])(
  "explicit %s aliases are supported",
  (encoding) => {
    expect(decodeText(Buffer.from("d6d0cec4", "hex"), encoding).content).toBe(
      "中文"
    );
  }
);

test("malformed explicit encodings fail instead of replacing bytes", () => {
  expect(() => decodeText(Buffer.from([0xff]), "utf-8")).toThrow();
  expect(() =>
    decodeText(Buffer.from([0x81, 0x30, 0x81]), "gb18030")
  ).toThrow();
  expect(() => decodeText(Buffer.from([0xff, 0xfe, 0x2d]))).toThrow();
  expect(() => decodeText(Buffer.from("hello"), "unknown")).toThrow(
    "Unsupported"
  );
});

test("NUL bytes are rejected and existing replacement characters are reported", () => {
  expect(() => decodeText(Buffer.from("a\0b"))).toThrow("NUL");
  expect(decodeText(Buffer.from("中文\ufffd")).warnings).toEqual([
    expect.objectContaining({ code: "TEXT_REPLACEMENT_CHARACTERS" }),
  ]);
});
