import { isDirectRun } from "./office_io.ts";
import { runParse } from "./parse_formats.ts";

if (isDirectRun(import.meta.url)) {
  try {
    const printed = runParse(["--format", "csv", ...process.argv.slice(2)]);
    if (printed) console.log(printed);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
