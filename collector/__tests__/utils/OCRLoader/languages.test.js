const OCRLoader = require("../../../utils/OCRLoader");

test("Chinese and English are the default and invalid-list fallback", () => {
  const loader = Object.create(OCRLoader.prototype);
  for (const language of [undefined, null, "", "unknown"])
    expect(loader.parseLanguages(language)).toEqual(["chi_sim", "eng"]);
});

test("an explicit language selection keeps its order and is authoritative", () => {
  const loader = Object.create(OCRLoader.prototype);
  expect(loader.parseLanguages("eng")).toEqual(["eng"]);
  expect(loader.parseLanguages(" chi_tra, eng,unknown ")).toEqual([
    "chi_tra",
    "eng",
  ]);
});
