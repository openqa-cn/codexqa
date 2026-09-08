# Benchmarks

We report defect detection, false positives, evidence completeness, runtime, and cost. Stars, generated test count, and raw model output are not sufficient quality metrics.

## What exists today

One evaluation fixture with a published answer key and a documented blind protocol: [`examples/inventory-service`](../examples/inventory-service/README.md). It contains seven business-logic defects with no syntactic signature, plus four decoy functions so that false positives are measurable rather than assumed.

```bash
node examples/inventory-service/verify.mjs      # executable answer key, no model involved
```

One agent run has been recorded against it under the blind protocol described in that README: recall 7/7, precision 7/7, and **zero** of the seven found by the 102 Semgrep seed rules.

## What this is not

That number is a single model, a single run, on a fixture authored by this project. It demonstrates that the workflow produces verifiable findings end to end; it is not a benchmark score and should not be compared with published figures for other tools.

Reaching something worth calling a benchmark needs, at minimum:

- Multiple host models, with variance across repeated runs rather than one sample
- Fixtures contributed from outside this project
- Defect classes we did not plant ourselves, including regressions harvested from real repositories
- Cost and runtime recorded per run, not just accuracy

## Contributing an evaluation case

The most useful contributions are minimal public reproductions of missed defects and false positives. A good case follows the `inventory-service` shape: a known-good baseline, a branch whose changes are individually plausible, an explicit specification the defect violates, decoys alongside the real defects, and an executable answer key. See [Contributing](../CONTRIBUTING.md), and strip credentials and proprietary source first.
