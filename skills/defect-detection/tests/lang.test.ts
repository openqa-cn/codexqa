import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ALL_PROFILES,
  UNKNOWN_LANGUAGE,
  canonicalize_language,
  class_name_to_relative_path,
  code_fence_for_language,
  detect_project_language,
  dominant_language,
  guess_file_path_for_class,
  infer_class_name,
  is_client_language,
  is_client_path,
  has_path_class_name,
  language_breakdown,
  language_from_path,
  resolve_language,
  strip_source_prefixes,
  try_gitnexus_for_language,
} from "../scripts/lang.ts";

describe("language registry", () => {
  it("canonicalizes aliases", () => {
    assert.equal(canonicalize_language("JS"), "javascript");
    assert.equal(canonicalize_language("c#"), "csharp");
    assert.equal(canonicalize_language("C++"), "cpp");
    assert.equal(canonicalize_language("py"), "python");
    assert.equal(canonicalize_language("golang"), "go");
    assert.equal(canonicalize_language("kt"), "kotlin");
    assert.equal(canonicalize_language(""), "");
    assert.equal(canonicalize_language(null), "");
  });

  it("maps file extensions to languages", () => {
    assert.equal(language_from_path("src/main/java/com/a/Foo.java"), "java");
    assert.equal(language_from_path("pkg/handler/user.go"), "go");
    assert.equal(language_from_path("app/api/users.py"), "python");
    assert.equal(language_from_path("src/components/Button.tsx"), "typescript");
    assert.equal(language_from_path("src/utils/date.mjs"), "javascript");
    assert.equal(language_from_path("Services/OrderService.cs"), "csharp");
    assert.equal(language_from_path("src/net/socket.cc"), "cpp");
    assert.equal(language_from_path("src/net/socket.h"), "c");
    assert.equal(language_from_path("src/main/kotlin/com/a/Svc.kt"), "kotlin");
    assert.equal(language_from_path("src/main/scala/com/a/Svc.scala"), "scala");
    assert.equal(language_from_path("lib/app.rb"), "ruby");
    assert.equal(language_from_path("README.md"), null);
    assert.equal(language_from_path("Makefile"), null);
  });

  it("exposes per-language policy", () => {
    assert.equal(code_fence_for_language("typescript"), "typescript");
    assert.equal(code_fence_for_language("c#"), "csharp");
    assert.equal(code_fence_for_language("unknown"), "text");
    assert.equal(is_client_language("javascript"), true);
    assert.equal(is_client_language("tsx"), true);
    assert.equal(is_client_language("python"), false);
    assert.equal(try_gitnexus_for_language("java"), true);
    assert.equal(try_gitnexus_for_language("go"), true);
    assert.equal(try_gitnexus_for_language("typescript"), false);
    assert.equal(try_gitnexus_for_language(UNKNOWN_LANGUAGE), false);
  });

  it("does not treat server path-style languages as frontend / client", () => {
    assert.equal(is_client_path("handler_audio_jobs.go", "go"), false);
    assert.equal(is_client_path("internal/pay/charge.go"), false);
    assert.equal(is_client_path("app/api/users.py", "python"), false);
    assert.equal(is_client_path("Services/OrderService.cs", "csharp"), false);
    assert.equal(is_client_path("src/net/socket.c", "c"), false);
    assert.equal(is_client_path("src/net/socket.cc", "cpp"), false);
    assert.equal(has_path_class_name("handler_audio_jobs.go", "go"), true);
    assert.equal(has_path_class_name("app/api/users.py", "python"), true);
    assert.equal(has_path_class_name("src/main/java/com/a/Foo.java", "java"), false);
    assert.equal(is_client_path("src/components/Button.tsx", "typescript"), true);
    assert.equal(is_client_path("src/utils/date.mjs", "javascript"), true);
    assert.equal(is_client_path("src/App.vue"), true);
    assert.equal(has_path_class_name("src/components/Button.tsx", "typescript"), true);
  });
});

describe("language detection", () => {
  it("counts files per language and ignores non-source files", () => {
    assert.deepEqual(
      language_breakdown(["a.go", "b.go", "c.py", "README.md", "go.mod"]),
      { go: 2, python: 1 },
    );
  });

  it("keeps the 70% threshold for detect_project_language", () => {
    assert.equal(detect_project_language(["a.py", "b.py", "c.py", "d.go"]), "python");
    assert.equal(detect_project_language(["a.py", "b.go"]), null);
    assert.equal(detect_project_language(["README.md"]), null);
  });

  it("dominant_language merges JS and TS", () => {
    assert.equal(dominant_language(["a.ts", "b.ts", "c.js", "d.js", "e.js"]), "typescript");
    assert.equal(dominant_language(["a.java", "b.go", "c.go"]), "go");
    assert.equal(dominant_language(["notes.txt"]), null);
  });
});

describe("resolve_language priority", () => {
  const files = ["cmd/api/main.go", "internal/pay/charge.go", "README.md"];

  it("explicit flag wins over everything", () => {
    const r = resolve_language({ explicit: "python", declared: "java", declaredSource: "declared", files });
    assert.equal(r.language, "python");
    assert.equal(r.source, "explicit");
  });

  it("a real declaration wins over detection and keeps its original source label", () => {
    const r = resolve_language({ declared: "kotlin", declaredSource: "declared", files });
    assert.equal(r.language, "kotlin");
    assert.equal(r.source, "declared");
    const r2 = resolve_language({ declared: "java", declaredSource: "explicit", files });
    assert.equal(r2.source, "explicit");
  });

  it("legacy java default is overridden when the diff has no Java", () => {
    const r = resolve_language({ declared: "java", files });
    assert.equal(r.language, "go");
    assert.equal(r.source, "detected");
    assert.match(r.note || "", /legacy default/);
  });

  it("legacy java default is kept when the diff contains Java", () => {
    const r = resolve_language({ declared: "java", files: ["src/main/java/A.java", "web/app.ts"] });
    assert.equal(r.language, "java");
    assert.equal(r.source, "declared");
    assert.equal(r.polyglot, true);
  });

  it("detects from files when nothing is declared", () => {
    const r = resolve_language({ files: ["src/a.ts", "src/b.tsx", "src/c.js"] });
    assert.equal(r.language, "typescript");
    assert.equal(r.source, "detected");
    assert.deepEqual(r.breakdown, { typescript: 2, javascript: 1 });
  });

  it("stays unknown when there are no files yet (no silent java default)", () => {
    const r = resolve_language({});
    assert.equal(r.language, UNKNOWN_LANGUAGE);
    assert.equal(r.source, "unknown");
  });

  it("honours an explicit language even when it is not in the support matrix", () => {
    const r = resolve_language({ explicit: "rust", files: ["src/a.ts"] });
    assert.equal(r.language, "rust");
    assert.equal(r.source, "explicit");
  });

  it("returns unknown when files exist but none is a recognised source", () => {
    const r = resolve_language({ files: ["docs/spec.md", "config/app.yaml"] });
    assert.equal(r.language, UNKNOWN_LANGUAGE);
    assert.equal(r.source, "unknown");
  });
});

describe("class names and paths", () => {
  it("strips source roots per language", () => {
    assert.equal(strip_source_prefixes("src/main/java/com/a/Foo.java"), "com/a/Foo");
    assert.equal(strip_source_prefixes("svc/src/main/kotlin/com/a/Bar.kt"), "com/a/Bar");
    assert.equal(strip_source_prefixes("internal/pay/charge.go"), "pay/charge");
    assert.equal(strip_source_prefixes("app/api/users.py"), "api/users");
    assert.equal(strip_source_prefixes("Services/OrderService.cs", "csharp"), "Services/OrderService");
  });

  it("infers a source-root-relative class path for JVM and the full path for the rest", () => {
    assert.equal(infer_class_name("src/main/java/com/a/Foo.java"), "com/a/Foo");
    assert.equal(infer_class_name("src/main/kotlin/com/a/Bar.kt"), "com/a/Bar");
    assert.equal(infer_class_name("src/Acme/Orders/OrderService.cs"), "src/Acme/Orders/OrderService");
    assert.equal(infer_class_name("internal/pay/charge.go"), "internal/pay/charge");
    assert.equal(infer_class_name("app/api/users.py"), "app/api/users");
    assert.equal(infer_class_name("src/components/Button.tsx"), "src/components/Button");
    assert.equal(infer_class_name("src/net/socket.cc"), "src/net/socket");
  });

  it("maps class names back to relative paths", () => {
    assert.equal(class_name_to_relative_path("com.a.Foo", "java"), "com/a/Foo");
    assert.equal(class_name_to_relative_path("internal/pay/charge", "go"), "internal/pay/charge");
    assert.equal(class_name_to_relative_path("com.a.Foo"), "com/a/Foo");
  });

  it("declares the className scheme each language actually produces", () => {
    for (const profile of ALL_PROFILES) {
      const root = profile.pathPrefixes[0];
      const produced = infer_class_name(`${root}pkg/Thing${profile.extensions[0]}`, profile.id);
      // fqcn drops the source root; path keeps the repo-relative path intact.
      const expected = profile.classNameScheme === "fqcn" ? "pkg/Thing" : `${root}pkg/Thing`;
      assert.equal(produced, expected, `${profile.id} declares ${profile.classNameScheme}`);
    }
  });

  it("guesses a file path per language and never invents src/main/java for other languages", () => {
    assert.equal(guess_file_path_for_class("com/a/Foo", "java"), "src/main/java/com/a/Foo.java");
    assert.equal(guess_file_path_for_class("com.a.Foo", "java"), "src/main/java/com/a/Foo.java");
    assert.equal(guess_file_path_for_class("com/a/Foo", "kotlin"), "src/main/kotlin/com/a/Foo.kt");
    assert.equal(guess_file_path_for_class("internal/pay/charge", "go"), "internal/pay/charge.go");
    assert.equal(guess_file_path_for_class("app/api/users", "python"), "app/api/users.py");
    assert.equal(guess_file_path_for_class("src/components/Button", "typescript"), "src/components/Button.ts");
  });
});
