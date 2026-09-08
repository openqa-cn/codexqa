/**
 * Minimal argparse compatible with the Python CLI contract.
 * Dest names stay snake_case (--task-id → task_id).
 */

export type ArgType = "string" | "int" | "float";

export interface ArgSpec {
  flags: string[];
  dest: string;
  help?: string;
  required?: boolean;
  default?: any;
  type?: ArgType;
  choices?: any[];
  storeTrue?: boolean;
  exclusiveGroup?: string;
  /** Group-level required: at least one member must be present. Not the same as member.required. */
  exclusiveGroupRequired?: boolean;
}

export interface SubparserSpec {
  name: string;
  help?: string;
  args: ArgSpec[];
}

function destFromFlag(flag: string, dest?: string): string {
  if (dest) return dest;
  return flag.replace(/^--/, "").replace(/-/g, "_");
}

export class ArgumentParser {
  description: string;
  epilog: string;
  globals: ArgSpec[] = [];
  subparsers: SubparserSpec[] = [];
  requiredSub = true;

  constructor(opts: { description?: string; epilog?: string } = {}) {
    this.description = opts.description || "";
    this.epilog = opts.epilog || "";
  }

  add_argument(flag: string, spec: Partial<ArgSpec> & { dest?: string } = {}): void {
    this.globals.push({
      flags: [flag],
      dest: destFromFlag(flag, spec.dest),
      help: spec.help,
      required: spec.required,
      default: spec.default,
      type: spec.type || "string",
      choices: spec.choices,
      storeTrue: spec.storeTrue,
    });
  }

  add_subparsers(_opts?: { dest?: string; required?: boolean }): {
    add_parser: (name: string, opts?: { help?: string }) => SubParser;
  } {
    const self = this;
    return {
      add_parser(name: string, opts: { help?: string } = {}) {
        const sub: SubparserSpec = { name, help: opts.help, args: [] };
        self.subparsers.push(sub);
        return new SubParser(sub);
      },
    };
  }

  parse_args(argv: string[] = process.argv.slice(2)): Record<string, any> {
    if (argv.includes("-h") || argv.includes("--help")) {
      const cmdIdx = argv.findIndex((a) => !a.startsWith("-"));
      if (cmdIdx >= 0 && this.subparsers.some((s) => s.name === argv[cmdIdx])) {
        this.print_subcommand_help(argv[cmdIdx]);
      } else {
        this.print_help();
      }
      process.exit(0);
    }

    const result: Record<string, any> = {};
    for (const g of this.globals) {
      if (g.default !== undefined) result[g.dest] = g.default;
      else if (g.storeTrue) result[g.dest] = false;
      else result[g.dest] = undefined;
    }

    let i = 0;
    const rest: string[] = [];
    while (i < argv.length) {
      const tok = argv[i];
      const g = this.globals.find((x) => x.flags.includes(tok));
      if (g) {
        if (g.storeTrue) {
          result[g.dest] = true;
          i += 1;
        } else {
          const raw = argv[i + 1];
          if (raw === undefined) this.fail(`option ${tok} requires an argument`);
          result[g.dest] = coerce(raw, g);
          i += 2;
        }
      } else {
        rest.push(tok);
        i += 1;
      }
    }

    const cmd = rest[0];
    if (!cmd) {
      if (this.requiredSub) {
        this.print_usage();
        this.fail("the following arguments are required: cmd");
      }
      result.cmd = undefined;
      return result;
    }
    const sub = this.subparsers.find((s) => s.name === cmd);
    if (!sub) {
      this.fail(`invalid choice: '${cmd}'`);
    }
    result.cmd = cmd;
    for (const a of sub.args) {
      if (a.default !== undefined) result[a.dest] = a.default;
      else if (a.storeTrue) result[a.dest] = false;
      else result[a.dest] = undefined;
    }

    const seenExclusive = new Map<string, string>();
    i = 1;
    const subArgv = rest.slice(1);
    while (i < rest.length) {
      const tok = rest[i];
      const spec = sub.args.find((x) => x.flags.includes(tok));
      if (!spec) {
        this.fail(`unrecognized arguments: ${tok}`);
      }
      if (spec.exclusiveGroup) {
        const prev = seenExclusive.get(spec.exclusiveGroup);
        if (prev && prev !== spec.dest) {
          this.fail(`argument ${tok}: not allowed with argument --${prev.replace(/_/g, "-")}`);
        }
        seenExclusive.set(spec.exclusiveGroup, spec.dest);
      }
      if (spec.storeTrue) {
        result[spec.dest] = true;
        i += 1;
      } else {
        const raw = rest[i + 1];
        if (raw === undefined) this.fail(`option ${tok} requires an argument`);
        result[spec.dest] = coerce(raw, spec);
        i += 2;
      }
    }

    for (const a of sub.args) {
      if (a.required && (result[a.dest] === undefined || result[a.dest] === null)) {
        this.fail(`the following arguments are required: ${a.flags[0]}`);
      }
    }
    const groups = new Map<string, ArgSpec[]>();
    for (const a of sub.args) {
      if (a.exclusiveGroup) {
        const list = groups.get(a.exclusiveGroup) || [];
        list.push(a);
        groups.set(a.exclusiveGroup, list);
      }
    }
    for (const [, members] of groups) {
      const required = members.some((m) => m.exclusiveGroupRequired);
      const filled = members.filter((m) => result[m.dest] !== undefined && result[m.dest] !== null);
      if (required && filled.length === 0) {
        this.fail(`one of the arguments ${members.map((m) => m.flags[0]).join(" ")} is required`);
      }
    }
    void subArgv;
    return result;
  }

  print_help(): void {
    const lines = [
      `usage: detect.ts [-h] [--token TOKEN] cmd ...`,
      "",
      this.description,
      "",
      "options:",
      "  -h, --help     show this help message and exit",
      ...this.globals.map((g) => `  ${g.flags.join(", ")}  ${g.help || ""}`),
      "",
      "subcommands:",
      ...this.subparsers.map((s) => `  ${s.name.padEnd(28)} ${s.help || ""}`),
    ];
    if (this.epilog) lines.push("", this.epilog);
    console.log(lines.join("\n"));
  }

  print_subcommand_help(name: string): void {
    const sub = this.subparsers.find((s) => s.name === name);
    if (!sub) {
      this.print_help();
      return;
    }
    const req = sub.args.filter((a) => a.required).map((a) => a.flags[0]).join(" ");
    const lines = [
      `usage: detect.ts ${name} [-h] ${req}`,
      "",
      sub.help || "",
      "",
      "options:",
      "  -h, --help     show this help message and exit",
      ...sub.args.map((a) => `  ${a.flags.join(", ")}  ${a.help || ""}`),
    ];
    console.log(lines.join("\n"));
  }

  print_usage(): void {
    console.error("usage: detect.ts [-h] [--token TOKEN] cmd ...");
  }

  fail(msg: string): never {
    this.print_usage();
    console.error(`detect.ts: error: ${msg}`);
    process.exit(2);
  }
}

export class SubParser {
  sub: SubparserSpec;
  constructor(sub: SubparserSpec) {
    this.sub = sub;
  }

  add_argument(flag: string, spec: Partial<ArgSpec> & { dest?: string; action?: string; aliases?: string[] } = {}): void {
    this.sub.args.push({
      flags: [flag, ...(spec.aliases || [])],
      dest: destFromFlag(flag, spec.dest),
      help: spec.help,
      required: spec.required,
      default: spec.default,
      type: spec.type || "string",
      choices: spec.choices,
      storeTrue: spec.storeTrue || spec.action === "store_true",
      exclusiveGroup: spec.exclusiveGroup,
      exclusiveGroupRequired: spec.exclusiveGroupRequired,
    });
  }

  add_mutually_exclusive_group(opts: { required?: boolean } = {}): {
    add_argument: (flag: string, spec?: Partial<ArgSpec> & { dest?: string }) => void;
  } {
    const id = `ex-${this.sub.args.length}`;
    const groupRequired = !!opts.required;
    const self = this;
    return {
      add_argument(flag: string, spec: Partial<ArgSpec> & { dest?: string } = {}) {
        self.add_argument(flag, {
          ...spec,
          exclusiveGroup: id,
          exclusiveGroupRequired: groupRequired,
        });
      },
    };
  }
}

function coerce(raw: string, spec: ArgSpec): any {
  let value: any = raw;
  if (spec.type === "int") {
    value = parseInt(raw, 10);
    if (Number.isNaN(value)) {
      console.error(`detect.ts: error: invalid int value: '${raw}'`);
      process.exit(2);
    }
  } else if (spec.type === "float") {
    value = parseFloat(raw);
    if (Number.isNaN(value)) {
      console.error(`detect.ts: error: invalid float value: '${raw}'`);
      process.exit(2);
    }
  }
  if (spec.choices && !spec.choices.includes(value)) {
    console.error(`detect.ts: error: invalid choice: '${raw}' (choose from ${spec.choices.join(", ")})`);
    process.exit(2);
  }
  return value;
}
