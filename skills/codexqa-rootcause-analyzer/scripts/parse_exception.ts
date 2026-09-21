export type FrameLanguage = "java" | "python" | "node" | "generic";

export type StackFrame = {
  raw: string;
  language: FrameLanguage;
  className: string | null;
  methodName: string | null;
  file: string | null;
  line: number | null;
  library: boolean;
  key: string | null;
  causeIndex: number;
};

export type ExceptionCause = {
  exceptionType: string | null;
  message: string | null;
};

export type ParsedException = {
  exceptionType: string | null;
  message: string | null;
  causes: ExceptionCause[];
  frames: StackFrame[];
  appFrames: StackFrame[];
  primaryFrame: StackFrame | null;
  language: FrameLanguage | "mixed" | "unknown";
};

const JAVA_LIBRARY_PREFIXES = [
  "java.",
  "javax.",
  "jakarta.",
  "jdk.",
  "sun.",
  "com.sun.",
  "org.springframework.",
  "org.apache.",
  "org.hibernate.",
  "org.slf4j.",
  "org.junit.",
  "org.mockito.",
  "org.gradle.",
  "net.sf.cglib.",
  "kotlin.",
  "scala.",
  "groovy.",
  "com.mysql.",
  "com.zaxxer.",
  "com.alibaba.druid.",
  "com.alibaba.fastjson.",
  "com.dianping.zebra.",
  "com.mchange.",
  "org.mybatis.",
  "io.netty.",
  "io.grpc.",
  "reactor.",
  "io.reactivex.",
  "ch.qos.logback.",
  "com.fasterxml.",
  "org.eclipse.",
  "com.meituan.service.mobile.mtthrift.",
  "com.meituan.xframe.",
];

const NODE_LIBRARY_RE =
  /^(node:|internal\/|Module\.|_http_|events\.js|task_queues|async_hooks)/i;

const PYTHON_LIBRARY_RE = /<frozen |site-packages|\/lib\/python\d/i;

const JAVA_HEADER =
  /^\s*(?:Caused by:\s+|Suppressed:\s+)?([\w.$]+(?:Exception|Error|Throwable|Failure))(?:\s*:\s*(.*))?$/;
const JAVA_FRAME =
  /^\s*at\s+(?:[\w.]+\/)?([\w.$]+)\.([\w$<>]+)\(([^)]+)\)\s*$/;
const PYTHON_FRAME = /^\s*File "([^"]+)", line (\d+)(?:, in (.+))?\s*$/;
const PYTHON_HEADER = /^\s*([\w.]+(?:Error|Exception|Warning|Exit))(?::\s*(.*))?$/;
const NODE_FRAME_PAREN =
  /^\s*at\s+(?:(async)\s+)?(?:(.+?)\s+)?\(([^()]+):(\d+):(\d+)\)\s*$/;
const NODE_FRAME_BARE = /^\s*at\s+([^()]+):(\d+):(\d+)\s*$/;
const GENERIC_FILE_LINE = /([\w./\\-]+\.\w+):(\d+)/;

function frame_key(className: string | null, methodName: string | null): string | null {
  if (!className && !methodName) return null;
  if (className && methodName) return `${short_class(className)}#${methodName}`;
  return className || methodName;
}

function short_class(className: string): string {
  const parts = className.split(/[./]/);
  return parts[parts.length - 1] || className;
}

function parse_java_location(loc: string): { file: string | null; line: number | null } {
  if (!loc || loc === "Native Method" || loc === "Unknown Source") {
    return { file: null, line: null };
  }
  const m = loc.match(/^(.+):(\d+)$/);
  if (m) return { file: m[1], line: Number(m[2]) };
  return { file: loc, line: null };
}

function is_java_library(className: string | null, file: string | null): boolean {
  const name = className || "";
  if (JAVA_LIBRARY_PREFIXES.some((p) => name.startsWith(p))) return true;
  if (/\$Client$/.test(name) || /\$Proxy\d+$/.test(name)) return true;
  const short = name.split(".").pop() || "";
  if (/\.thrift\./i.test(name) && /(Filter|Interceptor|Invoker)$/.test(short)) return true;
  if (file && /^(java\/|javax\/|jdk\/)/.test(file.replace(/\\/g, "/"))) return true;
  return false;
}

function is_node_library(file: string | null, fn: string | null): boolean {
  const blob = `${fn || ""} ${file || ""}`;
  if (NODE_LIBRARY_RE.test(file || "") || NODE_LIBRARY_RE.test(fn || "")) return true;
  if (/node_modules/.test(file || "")) return true;
  if (/processTicksAndRejections|node:internal/.test(blob)) return true;
  return false;
}

function is_python_library(file: string | null): boolean {
  return !!(file && PYTHON_LIBRARY_RE.test(file));
}

function detect_language(text: string): FrameLanguage | "unknown" {
  if (/^\s*at\s+[\w.$]+\.[\w$<>]+\([^)]*\)/m.test(text) || /Caused by:\s+[\w.$]+(?:Exception|Error)/.test(text)) {
    return "java";
  }
  if (/Traceback \(most recent call last\)/.test(text) || /^\s*File "[^"]+", line \d+/m.test(text)) {
    return "python";
  }
  if (/^\s*at\s+.+:\d+:\d+/m.test(text) || /^\s*at\s+\S+\s+\([^)]+:\d+:\d+\)/m.test(text)) {
    return "node";
  }
  return "unknown";
}

function make_frame(partial: Partial<StackFrame> & { raw: string; language: FrameLanguage }): StackFrame {
  const className = partial.className ?? null;
  const methodName = partial.methodName ?? null;
  return {
    raw: partial.raw,
    language: partial.language,
    className,
    methodName,
    file: partial.file ?? null,
    line: partial.line ?? null,
    library: !!partial.library,
    key: frame_key(className, methodName),
    causeIndex: partial.causeIndex ?? 0,
  };
}

const PLACEHOLDER_METHODS = new Set([
  "search",
  "run",
  "execute",
  "invoke",
  "apply",
  "handle",
  "process",
  "call",
]);

function looks_invented_java_frame(frame: StackFrame): boolean {
  if (frame.language !== "java") return false;
  if (frame.line === 1) return true;
  if (frame.line == null && frame.methodName && PLACEHOLDER_METHODS.has(frame.methodName)) return true;
  return false;
}

function class_only_frame(frame: Pick<StackFrame, "raw" | "className">, short: string, causeIndex: number): StackFrame {
  return make_frame({
    raw: frame.raw,
    language: "java",
    className: frame.className || short,
    methodName: null,
    file: `${short}.java`,
    line: null,
    library: false,
    causeIndex,
  });
}

/** Drop Agent-invented `Class#search:1` when the text already has `→ Class`. */
export function collapse_truncated_java_frames(
  frames: StackFrame[],
  text: string,
  causeIndex: number,
): StackFrame[] {
  const arrowShorts = [...text.matchAll(/→\s*([A-Z][\w$]+)/g)].map((m) => m[1]);
  const arrowSet = new Set(arrowShorts);
  const kept: StackFrame[] = [];
  const inventedByShort = new Map<string, StackFrame>();

  for (const frame of frames) {
    const short = frame.className ? short_class(frame.className) : "";
    const invented =
      looks_invented_java_frame(frame) &&
      !!short &&
      (arrowSet.has(short) || PLACEHOLDER_METHODS.has(frame.methodName || ""));
    if (invented) {
      inventedByShort.set(short, class_only_frame(frame, short, causeIndex));
      continue;
    }
    kept.push(frame);
  }

  const keptShorts = new Set(
    kept.map((f) => (f.className ? short_class(f.className) : "")).filter(Boolean),
  );
  for (const [short, frame] of inventedByShort) {
    if (keptShorts.has(short)) continue;
    kept.push(frame);
    keptShorts.add(short);
  }
  for (const short of arrowShorts) {
    if (keptShorts.has(short)) continue;
    kept.push(class_only_frame({ raw: `→ ${short}`, className: short }, short, causeIndex));
    keptShorts.add(short);
  }
  return kept;
}

function parse_java(text: string): ParsedException {
  const causes: ExceptionCause[] = [];
  const frames: StackFrame[] = [];
  let exceptionType: string | null = null;
  let message: string | null = null;
  let causeIndex = 0;

  for (const line of text.split(/\r?\n/)) {
    const header = line.match(JAVA_HEADER);
    if (header) {
      const type = header[1];
      const msg = header[2] ? header[2].trim() : null;
      if (!exceptionType) {
        exceptionType = type;
        message = msg;
      } else {
        causeIndex += 1;
        causes.push({ exceptionType: type, message: msg });
      }
      continue;
    }
    const fm = line.match(JAVA_FRAME);
    if (fm) {
      const className = fm[1];
      const methodName = fm[2];
      const loc = parse_java_location(fm[3]);
      frames.push(
        make_frame({
          raw: line.trim(),
          language: "java",
          className,
          methodName,
          file: loc.file,
          line: loc.line,
          library: is_java_library(className, loc.file),
          causeIndex,
        }),
      );
    }
  }

  return finalize(exceptionType, message, causes, collapse_truncated_java_frames(frames, text, causeIndex), "java");
}

function parse_python(text: string): ParsedException {
  const frames: StackFrame[] = [];
  let exceptionType: string | null = null;
  let message: string | null = null;
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fm = line.match(PYTHON_FRAME);
    if (fm) {
      const file = fm[1];
      const lineNo = Number(fm[2]);
      const func = fm[3] && fm[3] !== "<module>" ? fm[3] : null;
      frames.push(
        make_frame({
          raw: line.trim(),
          language: "python",
          className: null,
          methodName: func,
          file,
          line: lineNo,
          library: is_python_library(file),
          causeIndex: 0,
        }),
      );
      continue;
    }
    const header = line.match(PYTHON_HEADER);
    if (header && !/^\s*File /.test(line)) {
      exceptionType = header[1];
      message = header[2] ? header[2].trim() : null;
    }
  }

  return finalize(exceptionType, message, [], frames, "python");
}

function split_node_fn(fn: string | null): { className: string | null; methodName: string | null } {
  if (!fn) return { className: null, methodName: null };
  const cleaned = fn.replace(/^async\s+/, "").replace(/^new\s+/, "");
  if (cleaned.includes(".")) {
    const parts = cleaned.split(".");
    const methodName = parts.pop() || null;
    const className = parts.join(".") || null;
    return { className, methodName };
  }
  return { className: null, methodName: cleaned };
}

function parse_node(text: string): ParsedException {
  const frames: StackFrame[] = [];
  let exceptionType: string | null = "Error";
  let message: string | null = null;
  const header = text.match(/^\s*([\w.]*?(?:Error|Exception))(?::\s*(.*))?/m);
  if (header) {
    exceptionType = header[1] || "Error";
    message = header[2] ? header[2].trim() : null;
  }

  for (const line of text.split(/\r?\n/)) {
    let fn: string | null = null;
    let file: string | null = null;
    let lineNo: number | null = null;
    const paren = line.match(NODE_FRAME_PAREN);
    if (paren) {
      fn = (paren[2] || "").trim() || null;
      file = paren[3];
      lineNo = Number(paren[4]);
    } else {
      const bare = line.match(NODE_FRAME_BARE);
      if (!bare) continue;
      file = bare[1];
      lineNo = Number(bare[2]);
    }
    const names = split_node_fn(fn);
    frames.push(
      make_frame({
        raw: line.trim(),
        language: "node",
        className: names.className,
        methodName: names.methodName,
        file,
        line: lineNo,
        library: is_node_library(file, fn),
        causeIndex: 0,
      }),
    );
  }

  return finalize(exceptionType, message, [], frames, "node");
}

function parse_generic(text: string): ParsedException {
  const frames: StackFrame[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(GENERIC_FILE_LINE);
    if (!m) continue;
    frames.push(
      make_frame({
        raw: line.trim(),
        language: "generic",
        className: null,
        methodName: null,
        file: m[1],
        line: Number(m[2]),
        library: false,
        causeIndex: 0,
      }),
    );
  }
  const header = text.match(/^\s*([\w.$]+(?:Exception|Error))(?::\s*(.*))?/m);
  return finalize(header?.[1] || null, header?.[2]?.trim() || null, [], frames, "generic");
}

function finalize(
  exceptionType: string | null,
  message: string | null,
  causes: ExceptionCause[],
  frames: StackFrame[],
  language: FrameLanguage,
): ParsedException {
  const appFrames = frames.filter((f) => !f.library);
  const primaryFrame =
    language === "python" && appFrames.length
      ? appFrames[appFrames.length - 1]
      : appFrames[0] || frames[0] || null;
  return {
    exceptionType,
    message,
    causes,
    frames,
    appFrames,
    primaryFrame,
    language: frames.length ? language : exceptionType ? language : "unknown",
  };
}

export function parse_exception(text: string): ParsedException {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  const lang = detect_language(raw);
  if (lang === "java") return parse_java(raw);
  if (lang === "python") return parse_python(raw);
  if (lang === "node") return parse_node(raw);
  const generic = parse_generic(raw);
  if (generic.frames.length) return generic;
  return parse_java(raw).frames.length ? parse_java(raw) : generic;
}
