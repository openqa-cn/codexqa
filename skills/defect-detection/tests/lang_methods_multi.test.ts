import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  class_name_for_file,
  extract_units_for_file,
  family_of_file,
  merge_semgrep_units,
  parse_semgrep_extract_output,
  semgrep_extract_rules_yaml,
} from "../scripts/lang_methods.ts";

function write_tmp(name: string, body: string): [string, string] {
  const dir = mkdtempSync(join(tmpdir(), "lang-multi-"));
  const abs = join(dir, name);
  writeFileSync(abs, body);
  return [abs, name];
}

function names(units: Array<{ methodName: string }>): string[] {
  return units.map((u) => u.methodName);
}

describe("family routing", () => {
  it("routes every profiled language to an extractor", () => {
    assert.equal(family_of_file("A.java"), "java");
    assert.equal(family_of_file("A.kt"), "kotlin");
    assert.equal(family_of_file("A.scala"), "scala");
    assert.equal(family_of_file("a.cc"), "c");
    assert.equal(family_of_file("a.h"), "c");
    assert.equal(family_of_file("A.cs"), "csharp");
    assert.equal(family_of_file("a.py", "python"), "python");
    assert.equal(family_of_file("weird.txt", "go"), "go");
  });

  it("keeps JVM class names source-root relative and others as full paths", () => {
    assert.equal(class_name_for_file("svc/src/main/java/com/a/Order.java"), "com/a/Order");
    assert.equal(class_name_for_file("src/main/kotlin/com/a/Svc.kt"), "com/a/Svc");
    assert.equal(class_name_for_file("src/main/scala/com/a/Svc.scala"), "com/a/Svc");
    assert.equal(class_name_for_file("src/Acme/OrderService.cs"), "src/Acme/OrderService");
    assert.equal(class_name_for_file("src/net/socket.cc"), "src/net/socket");
  });
});

describe("Java extraction", () => {
  it("finds methods, ignores constructors and control flow, handles wrapped signatures", () => {
    const [abs, rel] = write_tmp("OrderService.java", [
      "package com.a;",
      "public class OrderService {",
      "    private final Map<String, User> map;",
      "    public OrderService(Map<String, User> map) {",
      "        this.map = map;",
      "    }",
      "    @Transactional",
      "    public String checkout(String id) {",
      '        String s = "}{"; // } comment',
      "        if (id == null) {",
      "            return null;",
      "        }",
      "        return map.get(id).getName();",
      "    }",
      "    public static <T> List<T> wrap(",
      "            List<T> in,",
      "            int limit) {",
      "        return in.subList(0, limit);",
      "    }",
      "    private Map.Entry<String, Integer> first() { return null; }",
      "}",
    ].join("\n"));
    const units = extract_units_for_file(abs, rel);
    assert.deepEqual(names(units), ["checkout", "wrap", "first"]);
    assert.deepEqual([units[0].startLine, units[0].endLine, units[0].bodyLineCount], [8, 14, 5]);
    assert.equal(units[0].params, "String");
    assert.equal(units[0].returnType, "String");
    assert.equal(units[1].params, "List,int");
    assert.deepEqual([units[1].startLine, units[1].endLine], [15, 19]);
    assert.equal(units[0].language, "java");
    // one-liner `{ return null; }` has a body, it is not an empty method
    assert.equal(units[2].bodyLineCount, 1);
  });
});

describe("Kotlin extraction", () => {
  it("handles block bodies, expression bodies and abstract functions", () => {
    const [abs, rel] = write_tmp("Svc.kt", [
      "package com.a",
      "class Svc(private val repo: Repo) {",
      "    fun reserve(id: String, qty: Int): Boolean {",
      "        return qty > 0",
      "    }",
      "    suspend fun refund(id: String) = repo.refund(id)",
      "    override fun toString(): String =",
      "        \"Svc\"",
      "    private fun big(x: Int): Int = run {",
      "        x * 2",
      "    }",
      "}",
      "interface Repo {",
      "    fun refund(id: String): Boolean",
      "}",
      "fun topLevel() {",
      "    println(\"}\")",
      "}",
    ].join("\n"));
    const units = extract_units_for_file(abs, rel);
    assert.deepEqual(names(units), ["reserve", "refund", "toString", "big", "topLevel"]);
    assert.deepEqual([units[0].startLine, units[0].endLine], [3, 5]);
    assert.deepEqual([units[1].startLine, units[1].endLine], [6, 6]);
    assert.deepEqual([units[2].startLine, units[2].endLine], [7, 8]);
    assert.deepEqual([units[3].startLine, units[3].endLine], [9, 11]);
    assert.deepEqual([units[4].startLine, units[4].endLine], [16, 18]);
    assert.equal(units[0].params, "id: String,qty: Int");
    // expression bodies count their expression lines (never 0 → never "EMPTY_METHOD")
    assert.equal(units[1].bodyLineCount, 1);
    assert.equal(units[2].bodyLineCount, 1);
  });
});

describe("Scala extraction", () => {
  it("handles brace and expression bodies", () => {
    const [abs, rel] = write_tmp("Svc.scala", [
      "package com.a",
      "class Svc(repo: Repo) {",
      "  def reserve(id: String, qty: Int): Boolean = {",
      "    qty > 0",
      "  }",
      "  override def toString: String = \"Svc\"",
      "  private def pick[T](xs: List[T])(n: Int): T =",
      "    xs(n)",
      "  def abstractLike(x: Int): Int",
      "}",
    ].join("\n"));
    const units = extract_units_for_file(abs, rel);
    assert.deepEqual(names(units), ["reserve", "toString", "pick"]);
    assert.deepEqual([units[0].startLine, units[0].endLine], [3, 5]);
    assert.deepEqual([units[2].startLine, units[2].endLine], [7, 8]);
    assert.equal(units[2].params, "xs: List[T],n: Int");
  });
});

describe("C / C++ extraction", () => {
  it("finds definitions but not prototypes, macros or control flow", () => {
    const [abs, rel] = write_tmp("socket.cc", [
      "#include <string>",
      "static int helper(int a);",
      "namespace net {",
      "Socket::Socket(int fd) : fd_(fd) {",
      "  if (fd < 0) {",
      "    throw std::runtime_error(\"}\");",
      "  }",
      "}",
      "int Socket::send(const char* buf, size_t n) const {",
      "  for (size_t i = 0; i < n; i++) {",
      "    write(fd_, buf + i, 1);",
      "  }",
      "  return 0;",
      "}",
      "std::string* make_name(int id)",
      "{",
      "  return new std::string(std::to_string(id));",
      "}",
      "bool operator==(const Socket& a, const Socket& b) { return a.fd() == b.fd(); }",
      "}  // namespace net",
    ].join("\n"));
    const units = extract_units_for_file(abs, rel);
    assert.deepEqual(names(units), ["Socket", "send", "make_name", "operator=="]);
    assert.deepEqual([units[0].startLine, units[0].endLine], [4, 8]);
    assert.deepEqual([units[1].startLine, units[1].endLine], [9, 14]);
    assert.deepEqual([units[2].startLine, units[2].endLine], [15, 18]);
    assert.equal(units[1].returnType, "int");
  });

  it("handles plain C with pointers and K&R braces", () => {
    const [abs, rel] = write_tmp("buf.c", [
      "#define MAX 10",
      "struct buf { char *p; };",
      "char *buf_get(struct buf *b, int i)",
      "{",
      "    if (i < 0) return NULL;",
      "    return b->p + i;",
      "}",
      "static void buf_free(struct buf *b) { free(b->p); }",
    ].join("\n"));
    assert.deepEqual(names(extract_units_for_file(abs, rel)), ["buf_get", "buf_free"]);
  });
});

describe("C# extraction", () => {
  it("handles block bodies, expression bodies, constructors and skips interface members", () => {
    const [abs, rel] = write_tmp("OrderService.cs", [
      "using System;",
      "namespace Acme.Orders",
      "{",
      "    public interface IRepo",
      "    {",
      "        Task<bool> Refund(string id);",
      "    }",
      "    public class OrderService : IRepo",
      "    {",
      "        private readonly IRepo _repo;",
      "        public OrderService(IRepo repo)",
      "        {",
      "            _repo = repo;",
      "        }",
      "        public int Count { get; set; }",
      "        public async Task<bool> Refund(string id)",
      "        {",
      "            if (id == null) throw new ArgumentNullException(nameof(id));",
      "            return await _repo.Refund(id);",
      "        }",
      "        public override string ToString() => $\"Order {Count}\";",
      "        [Obsolete]",
      "        private static T Pick<T>(IList<T> xs, int n) where T : class",
      "        {",
      "            return xs[n];",
      "        }",
      "    }",
      "}",
    ].join("\n"));
    const units = extract_units_for_file(abs, rel);
    assert.deepEqual(names(units), ["OrderService", "Refund", "ToString", "Pick"]);
    assert.deepEqual([units[1].startLine, units[1].endLine], [16, 20]);
    assert.deepEqual([units[2].startLine, units[2].endLine], [21, 21]);
    assert.deepEqual([units[3].startLine, units[3].endLine], [23, 26]);
  });
});

describe("Semgrep-assisted refinement", () => {
  it("emits one EXTRACT rule per requested language", () => {
    const yaml = semgrep_extract_rules_yaml(["python", "go", "ruby"]);
    assert.match(yaml, /id: EXTRACT-PYTHON/);
    assert.match(yaml, /id: EXTRACT-GO/);
    assert.doesNotMatch(yaml, /RUBY/);
    assert.equal(semgrep_extract_rules_yaml(["ruby"]), "");
  });

  it("parses semgrep json into per-file ranges", () => {
    const out = parse_semgrep_extract_output(JSON.stringify({
      results: [
        { check_id: "EXTRACT-PYTHON", path: "/repo/app/svc.py", start: { line: 3 }, end: { line: 9 }, extra: { metavars: { $F: { abstract_content: "reserve" } } } },
        { check_id: "EXTRACT-PYTHON", path: "/repo/app/svc.py", start: { line: 3 }, end: { line: 10 }, extra: { metavars: { $F: { abstract_content: "reserve" } } } },
        { check_id: "EXTRACT-PYTHON", path: "app/svc.py", start: { line: 12 }, end: { line: 14 }, extra: { metavars: { $F: { abstract_content: "flush" } } } },
      ],
    }), "/repo");
    assert.deepEqual(out["app/svc.py"].map((u) => [u.methodName, u.startLine, u.endLine]), [["reserve", 3, 10], ["flush", 12, 14]]);
  });

  it("adopts semgrep ranges, adds missed units, keeps regex-only ones", () => {
    const regex = [
      { methodName: "reserve", params: "id", startLine: 3, endLine: 8, bodyLineCount: 4, signature: "reserve(id)", rangeSource: "regex" as const },
      { methodName: "legacy", params: "", startLine: 20, endLine: 25, bodyLineCount: 4, signature: "legacy()", rangeSource: "regex" as const },
    ];
    const merged = merge_semgrep_units(regex, [
      { file: "a.py", methodName: "reserve", startLine: 3, endLine: 10 },
      { file: "a.py", methodName: "inner", startLine: 21, endLine: 23 },
      { file: "a.py", methodName: "flush", startLine: 12, endLine: 14 },
    ], "python");
    assert.deepEqual(merged.map((u) => [u.methodName, u.startLine, u.endLine, u.rangeSource]), [
      ["reserve", 3, 10, "semgrep"],
      ["flush", 12, 14, "semgrep"],
      ["legacy", 20, 25, "regex"],
    ]);
  });

  it("replaces a file-level fallback when semgrep finds real functions", () => {
    const merged = merge_semgrep_units(
      [{ methodName: "svc", params: "", startLine: 1, endLine: 40, bodyLineCount: 39, signature: "svc(<file>)", fileLevel: true }],
      [{ file: "svc.rb", methodName: "reserve", startLine: 3, endLine: 9 }],
    );
    assert.deepEqual(names(merged), ["reserve"]);
  });
});
