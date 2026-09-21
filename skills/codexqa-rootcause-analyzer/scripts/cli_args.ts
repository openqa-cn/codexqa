export type ArgSpec = {
  flags: string[];
  dest: string;
  help?: string;
  required?: boolean;
  storeTrue?: boolean;
  type?: "string" | "int";
};

export type SubSpec = {
  name: string;
  help: string;
  args: ArgSpec[];
};

function dest_from(flag: string): string {
  return flag.replace(/^--/, "").replace(/-/g, "_");
}

function print_help(description: string, subs: SubSpec[]): void {
  const lines = [description, "", "commands:"];
  for (const sub of subs) {
    lines.push(`  ${sub.name.padEnd(20)} ${sub.help}`);
  }
  lines.push("", "happy path: run --exception-file FILE --git|--dir|--file URL");
  lines.push("then: fill report.draft.md from facts.json, write-report --task-id N --from-draft");
  lines.push("do not: --help, analysis.json, scripts/*.ts, other skills, invent :1 frames, trim to a hard 字 cap");
  console.log(lines.join("\n"));
}

function print_sub_help(sub: SubSpec): void {
  const lines = [`${sub.name} — ${sub.help}`, "", "options:"];
  for (const a of sub.args) {
    const flag = a.flags[0];
    lines.push(`  ${flag.padEnd(22)} ${a.help || ""}`);
  }
  console.log(lines.join("\n"));
}

function coerce(spec: ArgSpec, raw: string): any {
  if (spec.type === "int") return Number(raw);
  return raw;
}

export function parse_args(
  argv: string[],
  description: string,
  subs: SubSpec[],
): { command: string; flags: Record<string, any> } {
  if (!argv.length || argv[0] === "-h" || argv[0] === "--help") {
    print_help(description, subs);
    process.exit(0);
  }
  if (argv[0].startsWith("-")) {
    return parse_args(["run", ...argv], description, subs);
  }
  const command = argv[0];
  const sub = subs.find((s) => s.name === command);
  if (!sub) {
    print_help(description, subs);
    throw new Error(`unknown command: ${command}`);
  }
  const rest = argv.slice(1);
  if (rest.includes("-h") || rest.includes("--help")) {
    print_sub_help(sub);
    process.exit(0);
  }

  const byFlag = new Map<string, ArgSpec>();
  for (const a of sub.args) {
    for (const f of a.flags) byFlag.set(f, a);
  }

  const flags: Record<string, any> = {};
  for (const a of sub.args) {
    if (a.storeTrue) flags[a.dest] = false;
  }

  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i];
    const spec = byFlag.get(tok);
    if (!spec) {
      throw new Error(`unknown option: ${tok}`);
    }
    if (spec.storeTrue) {
      flags[spec.dest] = true;
      continue;
    }
    const val = rest[i + 1];
    if (val == null || val.startsWith("-")) {
      throw new Error(`${tok} requires a value`);
    }
    flags[spec.dest] = coerce(spec, val);
    i += 1;
  }

  for (const a of sub.args) {
    if (a.required && (flags[a.dest] == null || flags[a.dest] === "")) {
      throw new Error(`${a.flags[0]} is required`);
    }
  }

  return { command, flags };
}

export function arg(flag: string, extra: Partial<ArgSpec> = {}): ArgSpec {
  return {
    flags: [flag],
    dest: extra.dest || dest_from(flag),
    help: extra.help,
    required: extra.required,
    storeTrue: extra.storeTrue,
    type: extra.type || "string",
  };
}
