import { runConvert } from "./convert_formats.ts";
import { isDirectRun } from "./office_io.ts";

if (isDirectRun(import.meta.url)) {
  try {
    console.log(runConvert(["--to", "csv", ...process.argv.slice(2)]));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
