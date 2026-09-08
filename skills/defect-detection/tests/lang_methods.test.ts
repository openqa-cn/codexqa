import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  class_name_for_file,
  extract_units_for_file,
  family_of_file,
  filter_units_by_line_ranges,
  is_jvm_file,
  is_source_file,
  strip_source,
} from "../scripts/lang_methods.ts";

function write_tmp(name: string, body: string): [string, string] {
  const dir = mkdtempSync(join(tmpdir(), "lang-methods-"));
  const abs = join(dir, name);
  writeFileSync(abs, body);
  return [abs, name];
}

function names(units: Array<{ methodName: string }>): string[] {
  return units.map((u) => u.methodName);
}

describe("file classification", () => {
  it("separates JVM, parseable and unparseable sources", () => {
    assert.equal(is_jvm_file("src/main/java/A.java"), true);
    assert.equal(is_jvm_file("src/a.js"), false);
    assert.equal(family_of_file("src/a.tsx"), "js");
    assert.equal(family_of_file("svc/handler.go"), "go");
    assert.equal(family_of_file("app/main.py"), "python");
    assert.equal(family_of_file("README.md"), null);
    assert.equal(is_source_file("pom.xml"), false);
    assert.equal(is_source_file("src/a.rs"), true);
  });

  it("derives a className from the repo-relative path, never a java path", () => {
    assert.equal(class_name_for_file("src/order/reservation.js"), "src/order/reservation");
    assert.equal(class_name_for_file("./checkout.mjs"), "checkout");
  });
});

describe("strip_source", () => {
  it("blanks string, template and comment contents but keeps code braces", () => {
    const src = [
      "function a() {",
      "  const s = \"} not a brace {\";",
      "  const t = `${x} } also not`;",
      "  // } comment brace",
      "  /* } block */",
      "  return s + t;",
      "}",
    ].join("\n");
    const stripped = strip_source(src, "js");
    assert.equal(stripped.length, 7);
    const braces = stripped.join("\n").split("").filter((c) => c === "{" || c === "}");
    // only the function's own braces survive (template `${` is blanked with its content)
    assert.deepEqual(braces, ["{", "}"]);
  });

  it("preserves physical lines for strings continued with CRLF", () => {
    const stripped = strip_source("const value = \"a\\\r\nb\";\r\nreturn value;\r\n", "js");
    assert.equal(stripped.length, 4);
    assert.match(stripped[2], /return value/);
    assert.ok(stripped.every((line) => !line.includes("\r")));
  });

  it("does not treat division as a regex literal", () => {
    const stripped = strip_source("const r = total / count; const t = 2;", "js");
    assert.match(stripped[0], /const t = 2;/);
  });

  it("blanks python triple-quoted docstrings", () => {
    const src = ['def f():', '    """', '    def g(): pass', '    """', '    return 1'].join("\n");
    const stripped = strip_source(src, "python");
    assert.doesNotMatch(stripped[2], /def g/);
  });
});

describe("JS/TS unit extraction", () => {
  it("finds declarations, arrow assignments, class and object methods", () => {
    const [abs, rel] = write_tmp("svc.js", [
      "export function reserve(orderId, qty) {",
      "  return qty > 0;",
      "}",
      "",
      "export const refund = async (orderId, amount) => {",
      "  await pay(orderId);",
      "  return amount;",
      "};",
      "",
      "const legacy = function (a) { return a; };",
      "",
      "class Cart {",
      "  constructor(items) {",
      "    this.items = items;",
      "  }",
      "  async total() {",
      "    return this.items.length;",
      "  }",
      "  static build(x) {",
      "    return new Cart(x);",
      "  }",
      "}",
      "",
      "export default {",
      "  handler: (req) => {",
      "    return req;",
      "  },",
      "};",
    ].join("\n"));

    const units = extract_units_for_file(abs, rel);
    const found = names(units);
    for (const expected of ["reserve", "refund", "legacy", "constructor", "total", "build", "handler"]) {
      assert.ok(found.includes(expected), `expected unit ${expected} in ${JSON.stringify(found)}`);
    }
    assert.ok(!units.some((u) => u.fileLevel), "a parseable file must not fall back to file level");
  });

  it("extracts class fields holding functions instead of falling back to file level", () => {
    const [abs, rel] = write_tmp("comp.jsx", [
      "export class Cart extends React.Component {",
      "  handleClick = (e) => {",
      "    this.setState({ n: this.state.n + 1 });",
      "  };",
      "  total = () => this.props.items.length;",
      "  legacy = function (a) { return a; };",
      "  render() {",
      "    return null;",
      "  }",
      "}",
    ].join("\n"));
    const units = extract_units_for_file(abs, rel);
    assert.deepEqual(names(units), ["handleClick", "total", "legacy", "render"]);
    assert.deepEqual([units[0].startLine, units[0].endLine], [2, 4]);
    assert.equal(units[1].expressionBody, true);
    assert.ok(!units.some((u) => u.fileLevel));
  });

  it("keeps a typed async class field as its own unit", () => {
    const [abs, rel] = write_tmp("svc.ts", [
      "export class Svc {",
      "  private cache = new Map();",
      "  fetchUser = async (id: string): Promise<User> => {",
      "    const u = await this.repo.get(id);",
      "    return u;",
      "  };",
      "}",
    ].join("\n"));
    const units = extract_units_for_file(abs, rel);
    assert.deepEqual(names(units), ["fetchUser"]);
    assert.deepEqual([units[0].startLine, units[0].endLine], [3, 6]);
    assert.equal(units[0].params, "id: string");
  });

  it("does not mistake control-flow keywords for functions", () => {
    const [abs, rel] = write_tmp("ctrl.js", [
      "function run(items) {",
      "  if (items.length) {",
      "    for (const i of items) {",
      "      while (i.next) {",
      "        i.step();",
      "      }",
      "    }",
      "  }",
      "  switch (items[0]) {",
      "    default:",
      "      break;",
      "  }",
      "  try {",
      "    risky();",
      "  } catch (e) {",
      "    log(e);",
      "  }",
      "  return items;",
      "}",
    ].join("\n"));

    assert.deepEqual(names(extract_units_for_file(abs, rel)), ["run"]);
  });

  it("reports the real body range so line ranges can be matched", () => {
    const [abs, rel] = write_tmp("range.js", [
      "function first() {",
      "  return 1;",
      "}",
      "function second() {",
      "  return 2;",
      "}",
    ].join("\n"));

    const units = extract_units_for_file(abs, rel);
    assert.deepEqual(units.map((u) => [u.methodName, u.startLine, u.endLine]), [
      ["first", 1, 3],
      ["second", 4, 6],
    ]);

    const changed = filter_units_by_line_ranges(units, [[5, 5]]);
    assert.deepEqual(names(changed), ["second"]);
  });

  it("handles a signature that wraps across lines", () => {
    const [abs, rel] = write_tmp("wrap.js", [
      "export function computeTotal(",
      "  items,",
      "  discount,",
      ") {",
      "  return items - discount;",
      "}",
    ].join("\n"));
    const units = extract_units_for_file(abs, rel);
    assert.deepEqual(names(units), ["computeTotal"]);
    assert.equal(units[0].params, "items,discount");
  });
});

describe("Python and Go extraction", () => {
  it("uses indentation for python bodies including methods", () => {
    const [abs, rel] = write_tmp("svc.py", [
      "import os",
      "",
      "def reserve(order_id, qty=1):",
      "    if qty <= 0:",
      "        return False",
      "    return True",
      "",
      "class Cart:",
      "    def total(self):",
      "        return 0",
      "",
      "    async def flush(self, force=False):",
      "        return None",
    ].join("\n"));

    const units = extract_units_for_file(abs, rel);
    assert.deepEqual(names(units), ["reserve", "total", "flush"]);
    assert.equal(units[0].startLine, 3);
    assert.equal(units[0].endLine, 6);
    assert.equal(units[0].params, "order_id,qty");
  });

  it("extracts go functions and methods with receivers", () => {
    const [abs, rel] = write_tmp("svc.go", [
      "package main",
      "",
      "func Reserve(id string) error {",
      "  return nil",
      "}",
      "",
      "func (s *Service) Refund(id string, amount int) error {",
      "  return nil",
      "}",
    ].join("\n"));
    assert.deepEqual(names(extract_units_for_file(abs, rel)), ["Reserve", "Refund"]);
  });
});

describe("file-level fallback", () => {
  it("returns one unit for a source file with no parseable functions", () => {
    const [abs, rel] = write_tmp("config.rs", "pub const LIMIT: u32 = 10;\n");
    const units = extract_units_for_file(abs, rel);
    assert.equal(units.length, 1);
    assert.equal(units[0].fileLevel, true);
    assert.equal(units[0].methodName, "config");
  });

  it("keeps a file-level unit even when the changed range misses it", () => {
    const [abs, rel] = write_tmp("data.rs", "pub const A: u32 = 1;\npub const B: u32 = 2;\n");
    const units = extract_units_for_file(abs, rel);
    assert.deepEqual(names(filter_units_by_line_ranges(units, [[99, 99]])), ["data"]);
  });
});
