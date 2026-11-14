# Synthetic local inference fixtures

These tiny ONNX graphs and WordPiece tokenizers are authored for this test suite.
They are not pretrained models and do not measure retrieval or Chinese language quality.

- `embedding`: casts token IDs to floats and repeats them across four hidden dimensions.
- `reranker`: computes the mean token ID as a single classification logit.

`runtime.cjs` imports copies into a temporary model library, disables remote loading,
and runs the actual Transformers.js/ONNX runtime through both application providers.
It also checks output shape, model reuse and loaded-model deletion protection.
No hosted API key or model download is required. The normal server native runtime
dependencies (`sharp`, `onnxruntime-node`) must be installed for the current platform.

Regenerate with `uv run --with onnx server/__tests__/fixtures/local-models/generate.py`.
Only select the `embedding` or `reranker` subfolder when testing the browser import UI.
