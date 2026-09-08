/**
 * Language registry — the single source of truth for everything the pipeline
 * needs to know about a programming language.
 *
 * Every other module (extractors, AST scan, trivial filter, write-back paths,
 * GitNexus policy, Agent docs routing) asks this module instead of testing
 * `endsWith(".java")` or hard-coding `src/main/java`. Adding a language means
 * adding one profile here plus its extractor / seed rules / gotchas file.
 *
 * Resolution order for a service language (see `resolve_language`):
 *   explicit CLI flag  >  declared by plan / service JSON  >  detected from
 *   changed files  >  `unknown` (file-level review; never silently `java`).
 */

import { extname } from "node:path";

export type LanguageId =
  | "java"
  | "kotlin"
  | "scala"
  | "javascript"
  | "typescript"
  | "python"
  | "go"
  | "c"
  | "cpp"
  | "csharp";

export const UNKNOWN_LANGUAGE = "unknown";

export type LanguageFamily = "jvm" | "js" | "python" | "go" | "c" | "dotnet";

export type TrivialConventions = {
  /** Method-name prefixes that mark a plain accessor when the body is tiny (`get`, `is`, `Get`, …). */
  accessorPrefixes: string[];
  /** Exact method names that are boilerplate (`toString`, `__repr__`, `String`, `Equals`, …). */
  boilerplateNames: string[];
  /** Builder / fluent-setter prefixes (`with`, `set`). */
  builderPrefixes: string[];
  /** Max body lines for an accessor to still count as trivial. */
  maxAccessorBody: number;
};

export type LanguageProfile = {
  id: LanguageId;
  family: LanguageFamily;
  aliases: string[];
  extensions: string[];
  /** Markdown fence tag used in write-back content. */
  codeFence: string;
  /** Source-root prefixes stripped when deriving a class name from a path. */
  pathPrefixes: string[];
  /** What a "method" is called in this language's diagnostics. */
  symbolKind: "method" | "function";
  /** `fqcn`: dotted class name (`com.acme.Foo`); `path`: extension-less repo path (`pkg/handler`). */
  classNameScheme: "fqcn" | "path";
  /** Whether `clone-and-diff` should try to build a GitNexus call graph. */
  gitnexus: "try" | "skip";
  trivial: TrivialConventions;
  /** Gotchas file the Agent loads in Phase 2 STEP C (relative to the skill root). */
  gotchasDoc: string;
  /** Prefixes of Semgrep seed rule ids that belong to this language. */
  astRulePrefixes: string[];
  /** Optional native analyzers the overlays layer may run when installed. */
  nativeAnalyzers: string[];
};

const JVM_TRIVIAL: TrivialConventions = {
  accessorPrefixes: ["get", "is", "has"],
  boilerplateNames: ["toString", "hashCode", "equals", "canEqual", "compareTo"],
  builderPrefixes: ["with", "set", "builder", "toBuilder", "newBuilder"],
  maxAccessorBody: 3,
};

const _PROFILES: LanguageProfile[] = [
  {
    id: "java",
    family: "jvm",
    aliases: ["java"],
    extensions: [".java"],
    codeFence: "java",
    pathPrefixes: ["src/main/java/", "src/test/java/"],
    symbolKind: "method",
    classNameScheme: "fqcn",
    gitnexus: "try",
    trivial: JVM_TRIVIAL,
    gotchasDoc: "references/rules/java-gotchas.md",
    astRulePrefixes: ["AST-BOOL-", "AST-EQ-", "AST-EXC-", "AST-NPE-", "AST-RES-", "AST-RET-", "AST-SQL-", "AST-TH-", "AST-SSRF-", "AST-JAVA-"],
    nativeAnalyzers: [],
  },
  {
    id: "kotlin",
    family: "jvm",
    aliases: ["kotlin", "kt"],
    extensions: [".kt", ".kts"],
    codeFence: "kotlin",
    pathPrefixes: ["src/main/kotlin/", "src/test/kotlin/", "src/main/java/", "src/test/java/"],
    symbolKind: "method",
    classNameScheme: "fqcn",
    gitnexus: "try",
    trivial: { ...JVM_TRIVIAL, boilerplateNames: [...JVM_TRIVIAL.boilerplateNames, "copy", "component1", "component2"] },
    gotchasDoc: "references/rules/kotlin-gotchas.md",
    astRulePrefixes: ["AST-KT-"],
    nativeAnalyzers: ["detekt"],
  },
  {
    id: "scala",
    family: "jvm",
    aliases: ["scala"],
    extensions: [".scala", ".sc"],
    codeFence: "scala",
    pathPrefixes: ["src/main/scala/", "src/test/scala/"],
    symbolKind: "method",
    classNameScheme: "fqcn",
    gitnexus: "try",
    trivial: { ...JVM_TRIVIAL, boilerplateNames: [...JVM_TRIVIAL.boilerplateNames, "copy", "apply", "unapply", "productPrefix"] },
    gotchasDoc: "references/rules/scala-gotchas.md",
    astRulePrefixes: ["AST-SC-"],
    nativeAnalyzers: [],
  },
  {
    id: "javascript",
    family: "js",
    aliases: ["javascript", "js", "jsx", "node", "nodejs"],
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    codeFence: "javascript",
    pathPrefixes: ["src/", "lib/", "app/", "packages/"],
    symbolKind: "function",
    classNameScheme: "path",
    gitnexus: "skip",
    trivial: {
      accessorPrefixes: ["get", "is", "has"],
      boilerplateNames: ["toString", "toJSON", "valueOf", "constructor", "render"],
      builderPrefixes: ["set", "with"],
      maxAccessorBody: 2,
    },
    gotchasDoc: "references/rules/frontend-gotchas.md",
    astRulePrefixes: ["AST-JS-"],
    nativeAnalyzers: ["eslint"],
  },
  {
    id: "typescript",
    family: "js",
    aliases: ["typescript", "ts", "tsx"],
    extensions: [".ts", ".tsx", ".mts", ".cts"],
    codeFence: "typescript",
    pathPrefixes: ["src/", "lib/", "app/", "packages/"],
    symbolKind: "function",
    classNameScheme: "path",
    gitnexus: "skip",
    trivial: {
      accessorPrefixes: ["get", "is", "has"],
      boilerplateNames: ["toString", "toJSON", "valueOf", "constructor", "render"],
      builderPrefixes: ["set", "with"],
      maxAccessorBody: 2,
    },
    gotchasDoc: "references/rules/frontend-gotchas.md",
    astRulePrefixes: ["AST-JS-", "AST-TS-"],
    nativeAnalyzers: ["eslint"],
  },
  {
    id: "python",
    family: "python",
    aliases: ["python", "py", "python3"],
    extensions: [".py", ".pyi"],
    codeFence: "python",
    pathPrefixes: ["src/", "lib/", "app/"],
    symbolKind: "function",
    classNameScheme: "path",
    gitnexus: "try",
    trivial: {
      accessorPrefixes: ["get_", "is_", "has_"],
      boilerplateNames: ["__repr__", "__str__", "__hash__", "__eq__", "__init__", "__len__", "__bool__"],
      builderPrefixes: ["set_", "with_"],
      maxAccessorBody: 2,
    },
    gotchasDoc: "references/rules/python-gotchas.md",
    astRulePrefixes: ["AST-PY-"],
    nativeAnalyzers: ["bandit", "ruff"],
  },
  {
    id: "go",
    family: "go",
    aliases: ["go", "golang"],
    extensions: [".go"],
    codeFence: "go",
    pathPrefixes: ["internal/", "pkg/", "cmd/"],
    symbolKind: "function",
    classNameScheme: "path",
    gitnexus: "try",
    trivial: {
      accessorPrefixes: ["Get", "Is", "Has"],
      boilerplateNames: ["String", "Error", "GoString", "MarshalJSON", "UnmarshalJSON"],
      builderPrefixes: ["Set", "With"],
      maxAccessorBody: 2,
    },
    gotchasDoc: "references/rules/go-gotchas.md",
    astRulePrefixes: ["AST-GO-"],
    nativeAnalyzers: ["gosec", "staticcheck", "govet"],
  },
  {
    id: "c",
    family: "c",
    aliases: ["c"],
    extensions: [".c", ".h"],
    codeFence: "c",
    pathPrefixes: ["src/", "include/", "lib/"],
    symbolKind: "function",
    classNameScheme: "path",
    gitnexus: "try",
    trivial: {
      accessorPrefixes: ["get_", "is_"],
      boilerplateNames: [],
      builderPrefixes: ["set_"],
      maxAccessorBody: 2,
    },
    gotchasDoc: "references/rules/c-cpp-gotchas.md",
    astRulePrefixes: ["AST-C-"],
    nativeAnalyzers: ["cppcheck"],
  },
  {
    id: "cpp",
    family: "c",
    aliases: ["cpp", "c++", "cxx", "cc"],
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".hh", ".ipp"],
    codeFence: "cpp",
    pathPrefixes: ["src/", "include/", "lib/"],
    symbolKind: "method",
    classNameScheme: "path",
    gitnexus: "try",
    trivial: {
      accessorPrefixes: ["get", "is", "get_", "is_"],
      boilerplateNames: ["operator==", "operator!=", "operator<<", "size", "empty", "begin", "end"],
      builderPrefixes: ["set", "set_"],
      maxAccessorBody: 2,
    },
    gotchasDoc: "references/rules/c-cpp-gotchas.md",
    astRulePrefixes: ["AST-CPP-"],
    nativeAnalyzers: ["cppcheck"],
  },
  {
    id: "csharp",
    family: "dotnet",
    aliases: ["csharp", "cs", "c#", "dotnet"],
    extensions: [".cs"],
    codeFence: "csharp",
    pathPrefixes: ["src/", "Source/"],
    symbolKind: "method",
    // Extraction keeps the full repo path (`src/Acme/Orders/OrderService`): unlike the
    // JVM there is no source root to strip back, and `guess_file_path_for_class` has
    // no root to re-add, so a namespace-style name would not map to a real file.
    classNameScheme: "path",
    gitnexus: "try",
    trivial: {
      accessorPrefixes: ["Get", "Is", "Has"],
      boilerplateNames: ["ToString", "GetHashCode", "Equals", "Dispose", "Deconstruct"],
      builderPrefixes: ["Set", "With"],
      maxAccessorBody: 2,
    },
    gotchasDoc: "references/rules/csharp-gotchas.md",
    astRulePrefixes: ["AST-CS-"],
    nativeAnalyzers: [],
  },
];

/**
 * Languages the AST scanner recognises by extension but that have no full
 * profile yet (no extractor / gotchas). They get file-level review only.
 */
const _AST_ONLY_EXTENSIONS: Record<string, string[]> = {
  ruby: [".rb"],
  swift: [".swift"],
  rust: [".rs"],
  php: [".php"],
};

const _BY_ALIAS = new Map<string, LanguageProfile>();
const _BY_EXT = new Map<string, LanguageProfile>();
for (const p of _PROFILES) {
  for (const a of p.aliases) _BY_ALIAS.set(a.toLowerCase(), p);
  for (const ext of p.extensions) _BY_EXT.set(ext.toLowerCase(), p);
}

/** language id → extension set, for every language the scanner recognises. */
export const LANG_TO_EXTENSIONS: Record<string, Set<string>> = (() => {
  const out: Record<string, Set<string>> = {};
  for (const p of _PROFILES) out[p.id] = new Set(p.extensions);
  for (const [lang, exts] of Object.entries(_AST_ONLY_EXTENSIONS)) out[lang] = new Set(exts);
  out.generic = new Set();
  return out;
})();

export const ALL_PROFILES: readonly LanguageProfile[] = _PROFILES;
export const SUPPORTED_LANGUAGES: readonly LanguageId[] = _PROFILES.map((p) => p.id);

export function canonicalize_language(raw: string | null | undefined): string {
  const key = String(raw || "").trim().toLowerCase();
  if (!key) return "";
  if (key === UNKNOWN_LANGUAGE) return UNKNOWN_LANGUAGE;
  const hit = _BY_ALIAS.get(key);
  return hit ? hit.id : key;
}

export function language_profile(raw: string | null | undefined): LanguageProfile | null {
  const id = canonicalize_language(raw);
  if (!id) return null;
  return _BY_ALIAS.get(id) || null;
}

export function is_known_language(raw: string | null | undefined): boolean {
  return language_profile(raw) != null;
}

function _ext_of(file_path: string): string {
  const base = String(file_path || "").split(/[/\\]/).pop() || "";
  const i = base.lastIndexOf(".");
  if (i <= 0) return extname(base).toLowerCase();
  return base.slice(i).toLowerCase();
}

/** Language id for one file, or null when the extension is not a known source type. */
export function language_from_path(file_path: string): string | null {
  const ext = _ext_of(file_path);
  if (!ext) return null;
  const p = _BY_EXT.get(ext);
  if (p) return p.id;
  for (const [lang, exts] of Object.entries(_AST_ONLY_EXTENSIONS)) {
    if (exts.includes(ext)) return lang;
  }
  return null;
}

export function profile_for_path(file_path: string): LanguageProfile | null {
  const p = _BY_EXT.get(_ext_of(file_path));
  return p || null;
}

/** True when the file belongs to any language the AST scanner knows (profile or AST-only). */
export function is_supported_source_path(file_path: string): boolean {
  return language_from_path(file_path) != null;
}

export function is_client_language(raw: string | null | undefined): boolean {
  return language_profile(raw)?.family === "js";
}

/** Client-side file types with no profile of their own: single-file components and style/markup assets. */
const _CLIENT_ONLY_EXTENSIONS = new Set([".vue", ".svelte", ".css", ".scss", ".less", ".html", ".htm"]);

/**
 * True for browser / client sources. Server languages with a path-style className
 * (go, python, c, csharp, …) are **not** client — use `has_path_class_name` for the
 * "className carries no package, so record the real file path" question instead.
 */
export function is_client_path(file_path: string, language?: string | null): boolean {
  if (is_client_language(language || language_from_path(file_path))) return true;
  return _CLIENT_ONLY_EXTENSIONS.has(extname(String(file_path || "")).toLowerCase());
}

/** True when the unit className is a repo path rather than a package-qualified name (everything outside the JVM). */
export function has_path_class_name(file_path: string, language?: string | null): boolean {
  return language_profile(language || language_from_path(file_path))?.family !== "jvm";
}

export function try_gitnexus_for_language(raw: string | null | undefined): boolean {
  const profile = language_profile(raw);
  if (!profile) return canonicalize_language(raw) !== UNKNOWN_LANGUAGE;
  return profile.gitnexus === "try";
}

export function code_fence_for_language(raw: string | null | undefined): string {
  return language_profile(raw)?.codeFence || "text";
}

/** Single-file component / markup formats that are not a language profile but have a fence of their own. */
const _EXTRA_FENCES: Record<string, string> = {
  ".vue": "vue",
  ".svelte": "svelte",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".html": "html",
  ".sql": "sql",
  ".sh": "bash",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".json": "json",
  ".xml": "xml",
};

export function code_fence_for_path(file_path: string): string {
  const profile = profile_for_path(file_path);
  if (profile) return profile.codeFence;
  const ext = extname(String(file_path || "")).toLowerCase();
  return _EXTRA_FENCES[ext] || code_fence_for_language(language_from_path(file_path));
}

export function gotchas_doc_for_language(raw: string | null | undefined): string | null {
  return language_profile(raw)?.gotchasDoc || null;
}

export function trivial_conventions(raw: string | null | undefined): TrivialConventions {
  return language_profile(raw)?.trivial || JVM_TRIVIAL;
}

/** Count changed files per language (only known source extensions). */
export function language_breakdown(files: readonly string[] | null | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of files || []) {
    const lang = language_from_path(String(f || ""));
    if (!lang) continue;
    counts[lang] = (counts[lang] || 0) + 1;
  }
  return counts;
}

/**
 * Dominant language of a file list when it holds at least `threshold` of the
 * recognised source files; otherwise null (mixed repo → caller decides).
 */
export function detect_project_language(target_files: readonly string[], threshold = 0.7): string | null {
  const counts = language_breakdown(target_files);
  const keys = Object.keys(counts);
  if (!keys.length) return null;
  let primary = keys[0];
  for (const lang of keys) if (counts[lang] > counts[primary]) primary = lang;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return counts[primary] / total >= threshold ? primary : null;
}

/** Distinct canonical languages present in a file list (only known source extensions). */
export function languages_in_files(files: readonly string[] | null | undefined): string[] {
  return Object.keys(language_breakdown(files)).sort();
}

/**
 * Semgrep `languages:` values a rule may carry for it to apply to a project made of
 * `langs`. TypeScript projects also take JavaScript rules; C++ projects also take C
 * rules (the reverse is not true: a `.js`-only repo has nothing for `as any` rules).
 * `generic` rules always apply.
 */
const _SEMGREP_RULE_LANG_SUPERSETS: Record<string, string[]> = {
  typescript: ["typescript", "javascript"],
  cpp: ["cpp", "c"],
};

export function semgrep_rule_languages_for(langs: Iterable<string | null | undefined>): Set<string> {
  const accepted = new Set<string>(["generic"]);
  for (const raw of langs) {
    const lang = canonicalize_language(raw);
    if (lang === UNKNOWN_LANGUAGE) continue;
    for (const l of _SEMGREP_RULE_LANG_SUPERSETS[lang] || [lang]) accepted.add(l);
  }
  return accepted;
}

/** Dominant language regardless of share (JS and TS are merged so a TS repo with .js configs still reads as TS). */
export function dominant_language(files: readonly string[] | null | undefined): string | null {
  const counts = language_breakdown(files);
  if (counts.typescript && counts.javascript) {
    counts.typescript += counts.javascript;
    delete counts.javascript;
  }
  let best: string | null = null;
  for (const [lang, n] of Object.entries(counts)) {
    if (best == null || n > counts[best]) best = lang;
  }
  return best;
}

export type LanguageSource = "explicit" | "declared" | "detected" | "fallback" | "unknown";

export type ResolvedLanguage = {
  language: string;
  source: LanguageSource;
  /** Per-language file counts from the supplied file list. */
  breakdown: Record<string, number>;
  /** True when more than one profiled language appears in the file list. */
  polyglot: boolean;
  note?: string;
};

/**
 * Decide the language of one service.
 *
 * - `explicit`: CLI `--language`
 * - `declared`: value already on the plan / service record, with `declaredSource`
 *   telling us whether a human wrote it or an old default filled it in
 * - `files`: changed files from `clone-and-diff` (or any file list)
 *
 * A legacy record that says `java` without a `languageSource` is treated as a
 * default, not a declaration: if the changed files contain no Java at all but
 * do contain another profiled language, detection wins.
 */
export function resolve_language(opts: {
  explicit?: string | null;
  declared?: string | null;
  declaredSource?: string | null;
  files?: readonly string[] | null;
}): ResolvedLanguage {
  const breakdown = language_breakdown(opts.files);
  const profiled = Object.keys(breakdown).filter((l) => is_known_language(l));
  const polyglot = profiled.length > 1;

  const explicit = canonicalize_language(opts.explicit);
  if (explicit) {
    if (is_known_language(explicit) || explicit === UNKNOWN_LANGUAGE) {
      return { language: explicit, source: "explicit", breakdown, polyglot };
    }
    // Honour an explicit but unprofiled language (e.g. rust) — never silently fall through (R1).
    return {
      language: explicit,
      source: "explicit",
      breakdown,
      polyglot,
      note: `language '${explicit}' is not in the support matrix; analysis may be limited`,
    };
  }

  const declared = canonicalize_language(opts.declared);
  const declared_is_real = Boolean(declared) && is_known_language(declared) &&
    (opts.declaredSource ? opts.declaredSource !== "fallback" : true);
  const legacy_default = declared === "java" && !opts.declaredSource;

  const detected = dominant_language(opts.files);

  if (declared_is_real && !legacy_default) {
    const src = (opts.declaredSource as LanguageSource) || "declared";
    return { language: declared, source: src, breakdown, polyglot };
  }
  if (legacy_default) {
    if (!breakdown.java && detected && detected !== "java") {
      return {
        language: detected,
        source: "detected",
        breakdown,
        polyglot,
        note: "service said java (legacy default) but the changed files contain no Java; using detected language",
      };
    }
    if (breakdown.java || !detected) {
      return { language: "java", source: "declared", breakdown, polyglot };
    }
  }
  if (detected) {
    return { language: detected, source: "detected", breakdown, polyglot };
  }
  if (!opts.files || !opts.files.length) {
    // Nothing to inspect yet (pre-clone). Stay unknown until clone-and-diff resolves it (R2).
    return { language: UNKNOWN_LANGUAGE, source: "unknown", breakdown, polyglot, note: "no files to inspect yet" };
  }
  return { language: UNKNOWN_LANGUAGE, source: "unknown", breakdown, polyglot, note: "changed files contain no recognised source extension" };
}

/** Remove the source-root prefix and extension: `src/main/java/com/a/Foo.java` → `com/a/Foo`. */
export function strip_source_prefixes(file_path: string, language?: string | null): string {
  let path = String(file_path || "").replace(/\\/g, "/").replace(/^\.\//, "");
  const profile = language_profile(language) || profile_for_path(path);
  const prefixes = profile?.pathPrefixes?.length
    ? profile.pathPrefixes
    : ["src/main/java/", "src/test/java/", "src/main/kotlin/", "src/"];
  for (const prefix of prefixes) {
    const idx = path.indexOf(prefix);
    if (prefix && idx >= 0) {
      path = path.slice(idx + prefix.length);
      break;
    }
  }
  return path.replace(/\.[^./]+$/, "");
}

/**
 * Class / module name used as `className` in plans and write-backs.
 * JVM (`classNameScheme: fqcn`) → source-root-relative, slash-separated
 * (`com/acme/OrderService`; the platform treats slash and dot forms as equal).
 * Everything else → extension-less repo path (`internal/pay/charge`, `src/api/user`),
 * kept in full so the path maps back to the real file without guessing.
 */
export function infer_class_name(file_path: string, language?: string | null): string {
  const path = String(file_path || "").replace(/\\/g, "/").replace(/^\.\//, "");
  const profile = language_profile(language) || profile_for_path(path);
  if (profile && profile.family === "jvm") return strip_source_prefixes(path, profile.id);
  return path.replace(/\.[^./]+$/, "");
}

/** Inverse of `infer_class_name`: `com.a.Foo` / `com/a/Foo` → `com/a/Foo`; path names pass through. */
export function class_name_to_relative_path(class_name: string, language?: string | null): string {
  const cn = String(class_name || "").trim();
  const profile = language_profile(language);
  if (!cn) return "";
  if (profile?.family === "jvm" || (!profile && !cn.includes("/") && cn.includes("."))) {
    return cn.replace(/\./g, "/");
  }
  return cn;
}

/**
 * Best-effort repo path for a className when no plan / diff evidence exists.
 * JVM → `<first source root>/<class path>.<ext>`; other languages → `<className>.<ext>`.
 * Callers must flag the result as guessed; it is a hint for the agent, never an authority.
 */
export function guess_file_path_for_class(class_name: string, language?: string | null): string {
  const profile = language_profile(language);
  if (!profile) {
    // Unknown language: path-style name as-is, no forced .java (R2/R8).
    return class_name_to_relative_path(class_name, null);
  }
  const rel = class_name_to_relative_path(class_name, profile.id);
  const ext = profile.extensions[0];
  if (profile.family === "jvm") {
    const root = profile.pathPrefixes[0] || "";
    return rel.startsWith(root) || rel.startsWith("src/") ? `${rel}${ext}` : `${root}${rel}${ext}`;
  }
  return rel.endsWith(ext) ? rel : `${rel}${ext}`;
}
