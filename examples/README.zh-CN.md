# 可复现示例

[English](README.md)

从[结账边界案例](checkout-boundary/README.md)开始：它包含正常实现、预置缺陷和可执行验证器。

```bash
node examples/checkout-boundary/verify.mjs
```

示例会验证正常实现通过，并确认缺陷实现接受零金额。它是确定性 fixture，不调用 AI，也不代表模型检测准确率。
