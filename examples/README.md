# Reproducible examples

[简体中文](README.zh-CN.md)

Start with [checkout boundary](checkout-boundary/README.md): a small positive-amount requirement, a known-good implementation, and a seeded boundary defect. Its verifier exercises both implementations.

[Polyglot service](polyglot-service/README.md) builds a Python + Go + TypeScript repository whose feature branch plants one seeded defect per language; it exercises language detection, per-language method extraction, the per-language Semgrep packs on one `run-ast-scan`, and non-Java write-back conventions.

[Inventory service](inventory-service/README.md) is the blind-evaluation fixture: a JavaScript service with an approved specification, seven business-logic defects hidden inside legitimate feature work, and four decoy functions that look wrong but are correct. None of the seven has a syntactic signature, so it measures semantic review and false positives rather than pattern matching. It carries an executable answer key, a documented blind protocol, and a recorded agent result.

For skill infrastructure, run the documented [CLI smoke check](../docs/GETTING_STARTED.md#verify-from-a-local-checkout).

These are ground-truth fixtures; `verify.mjs` in each does not invoke an AI model. The one recorded agent run is described in the [inventory service](inventory-service/README.md#recorded-result) example, with its conditions and limits stated there.
