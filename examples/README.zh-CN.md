# 可复现示例

[English](README.md)

不需要开 Agent 就能跑的小 fixture。报告长什么样见[根 README · 产物长什么样](../README.zh-CN.md#产物长什么样)。

从[结账边界案例](checkout-boundary/README.md)开始：它包含正常实现、预置缺陷和可执行验证器。

```bash
node examples/checkout-boundary/verify.mjs
```

示例会验证正常实现通过，并确认缺陷实现接受零金额。它是确定性 fixture，不调用 AI，也不代表模型检测准确率。

[多语言服务示例](polyglot-service/README.md)构建一个 Python + Go + TypeScript 仓库，特性分支上每种语言各预置一处缺陷，用于演练语言识别、按语言的方法抽取、一次 `run-ast-scan` 加载多语言 Semgrep 规则包，以及非 Java 的回写约定。

```bash
node examples/polyglot-service/make-git-fixture.mjs
```

[库存服务示例](inventory-service/README.md)是盲测 fixture：一个带正式需求规格的 JavaScript 服务，在合理的功能改动中藏了 7 处业务逻辑缺陷，另有 4 个「看起来像 bug 实则正确」的诱饵函数。这 7 处缺陷都没有语法特征，因此它衡量的是语义审查能力和误报率，而不是模式匹配。示例附带可执行答案键、盲测协议和一次已记录的 agent 运行结果。

```bash
node examples/inventory-service/verify.mjs
```
